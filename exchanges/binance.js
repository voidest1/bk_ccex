const Basex = require('./basex');
const crypto = require("crypto");

/**
 * @class
 * @extends Basex
 * @constructor
 */
class Binance extends Basex{
    /**
     * create an instance of binance
     * @constructor
     * @param {object} option
     * @param {string} [option.httpHost="https://api.binance.com"] - host for REST API
     * @param {string} [option.wssHost="wss://stream.binance.com:9443/stream"] - host for WebSocket
     * @param {object} [option.auth] - authentication
     * @param {string} option.auth.access - access id
     * @param {string} option.auth.secret - secret key
     * @inheritDoc
     */
    constructor(option={}) {
        option = {...{httpHost:'https://api.binance.com', wssHost:'wss://stream.binance.com:9443/stream'}, ...option};
        super(option);
        this.listenKey = {key:'', updateTime:0};
    }
    /**
     * @inheritDoc
     * @protected
     */
    async __refreshSymbols(){
        const query = {};
        const result = await this.#fetch('/api/v3/exchangeInfo', query);
        if(result.code !== 0) return;

        this.__symbols.updateTime = Date.now();
        for(const s of result.data.symbols){
            const ss = s['baseAsset']+'-'+s['quoteAsset'];
            this.__symbols.symbols[ss] = {symbol:ss, exSymbol:s.symbol, time:this.__symbols.updateTime};
        }
    }
    /**
     * @inheritDoc
     * @protected
     */
    async __refreshDepth(baseAsset, quoteAsset){
        const result = await this.#fetch('/api/v3/depth', {symbol:baseAsset+quoteAsset, limit:this.opt.depthLimit});
        if(result.code) return;
        const depth = this.__depths[baseAsset+'-'+quoteAsset];
        depth.updateTime = Date.now();
        depth.depth.asks = result.data.asks;
        depth.depth.bids = result.data.bids;
    }

    async __getPrivateWebSocketUri(){
        //binance doesn't support snapshot for account, so fetch balance first
        const result = await this.#fetch('/api/v3/account', {}, {auth:'USER_DATA'});
        if(result.code === 0){
            this.__account.commissionRates = {...result.data.commissionRates};
            for(const asset of result.data.balances){
                this.__account.balances[asset['asset']] = {asset:asset['asset'],free:asset.free, locked:asset.locked};
            }
            this.__account.updateTime = Date.now();
        }
        const key = await this.#getListenKey();
        this.listenKey.key = key;
        this.listenKey.updateTime = Date.now();
        return '?streams='+key;
    }
    /**
     * @inheritDoc
     * @protected
     */
    async __onOpenWebSocket(ws){
        if([5,10,20].indexOf(this.opt.depthLimit) === -1) return false;
        this.__wsPublic.id = 1;
        const params = [];
        for(const symbol in this.__depths){
            const depth = this.__depths[symbol];
            if(depth.refresh !== 'wss') continue;
            const s = this.__symbols.symbols[symbol];
            params.push(s.exSymbol.toLowerCase()+'@depth'+this.opt.depthLimit+'@100ms');
        }
        this.log(`Subscribe ${JSON.stringify(params)}`);
        ws.send(JSON.stringify({method:'SUBSCRIBE', params, id:this.__wsPublic.id++}));
        return true;
    }
    /**
     * @inheritDoc
     * @protected
     */
    async __onMessageWebSocket(ws, message){
        const data = JSON.parse(message.toString());
        if(data.stream === this.listenKey.key){
            if(data.data.e === 'outboundAccountPosition'){
                const assets = [];
                for(const asset of data.data['B']){
                    const u = {asset:asset['a'],free:asset['f'], locked:asset['l']};
                    assets.push(u);
                    this.__account.balances[asset['a']] = u;
                }
                return assets;
            }
            if(data.data.e === 'executionReport'){
                const o = data.data;
                return {symbol:o.s, clientId:o.c, side:o.S, type:o.o, timeInForce:o.f, quantity:o.q, price:o.p,
                    quoteQty:o.Q, orderId:o.i, executedQty:o.z, cumulativeQuoteQty:o.Z, status:o.X};
            }
        }else if(data.stream.indexOf('@depth') > -1){
            const stream = data.stream.split('@');
            const s = this.__getSymbolByEx(stream[0].toUpperCase());
            const depth = this.__depths[s.symbol];
            depth.updateTime = Date.now();
            depth.depth.asks = data.data.asks;
            depth.depth.bids = data.data.bids;
            return {symbol:s.symbol, depth};
        }else{
            this.error(`Unknown stream has receive ${message.toString()}`);
        }
    }

    /**
     * @protected
     * @param symbol
     * @returns {Promise<boolean>}
     */
    async __subscribeDepth(symbol){
        const s = this.__symbols.symbols[symbol];
        const param = s.exSymbol.toLowerCase()+'@depth'+this.opt.depthLimit+'@100ms';
        this.log(`Subscribe ["${param}"]`);
        this.__wsPublic.send(JSON.stringify({method:'SUBSCRIBE', params:[param], id:this.__wsPublic.id++}));
        return true;
    }
    async #fetch(uri, query, option = {}){
        let queryString = '';
        for(const key in query){
            queryString += (queryString?'&':'')+key+'='+encodeURIComponent(query[key]);
        }
        if(option.auth) {
            if(!this.opt['auth']){
                this.error(`No specification access&secret for request`);
                return {code:-1, msg:'No access&secret'};
            }
            option['headers'] = {'X-MBX-APIKEY': this.opt['auth']['access']};
            if(['TRADE', 'MARGIN', 'USER_DATA'].indexOf(option.auth) > -1) {
                queryString += (queryString?'&':'')+'timestamp='+Date.now();
                queryString += '&signature=' + crypto.createHmac('sha256', this.opt['auth']['secret']).update(queryString).digest('hex');
            }
        }
        const url = uri + (queryString?'?'+queryString:'');
        const result = await super.__fetch(url, option);
        if(result.code !== 0){
            this.log(option);
            this.error(`${option.method??'GET'} ${this.opt.httpHost+url} fail:${JSON.stringify(result)}`);
        }
        return result;
    }
    static #toSymbol(symbol){
        const s = symbol.toUpperCase().split('-');
        return s[0]+s[1];
    }
    async #getListenKey(expand = false){
        const result = await this.#fetch('/api/v3/userDataStream', {}, {auth:'USER_STREAM', method:expand?'PUT':'POST'});
        return result.data?.['listenKey'];
    }
}

module.exports = Binance;