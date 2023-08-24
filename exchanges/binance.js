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
     * @param {string} [option.wssHost="wss://stream.binance.com:9443/ws"] - host for WebSocket
     * @param {object} [option.auth] - authentication
     * @param {string} option.auth.access - access id
     * @param {string} option.auth.secret - secret key
     * @inheritDoc
     */
    constructor(option={}) {
        option = {...{httpHost:'https://api.binance.com', wssHost:'wss://stream.binance.com:9443/stream'}, ...option};
        super(option);
    }
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
    async __refreshDepth(baseAsset, quoteAsset){
        const result = await this.#fetch('/api/v3/depth', {symbol:baseAsset+quoteAsset, limit:this.opt.depthLimit});
        if(result.code) return;
        const depth = this.__depths[baseAsset+'-'+quoteAsset];
        depth.updateTime = Date.now();
        depth.depth.asks = result.data.asks;
        depth.depth.bids = result.data.bids;
    }
    async __onOpenWebSocket(ws){
        if([5,10,20].indexOf(this.opt.depthLimit) === -1) return false;
        const params = [];
        for(const symbol in this.__depths){
            const depth = this.__depths[symbol];
            if(depth.refresh !== 'wss') continue;
            const s = this.__symbols.symbols[symbol];
            params.push(s.exSymbol.toLowerCase()+'@depth'+this.opt.depthLimit+'@100ms');
        }
        this.log(`Subscribe ${JSON.stringify(params)}`);
        ws.send(JSON.stringify({method:'SUBSCRIBE', params, id:1}));
        return true;
    }
    async __onMessageWebSocket(ws, message){
        const data = JSON.parse(message.toString());
        if(data.stream){
            const stream = data.stream.split('@');
            const s = this.__getSymbolByEx(stream[0].toUpperCase());
            const depth = this.__depths[s.symbol];
            depth.updateTime = Date.now();
            depth.depth.asks = data.data.asks;
            depth.depth.bids = data.data.bids;
            if(this.__events['updateDepth']){
                this.__events['updateDepth'](s.symbol, depth);
            }
        }
    }
    async #fetch(uri, query, auth = false){
        let queryString = auth?'timestamp='+Date.now():'';
        for(const key in query){
            queryString += '&'+key+'='+encodeURIComponent(query[key]);
        }
        const option = {};
        if(auth) {
            queryString += '&signature=' + crypto.createHmac('sha256', this.opt.auth?.['secret']).update(queryString).digest('hex');
            option['headers'] = {'X-MBX-APIKEY': this.opt.auth?.['access']};
        }
        const url = uri + (queryString?'?'+queryString:'');
        const result = await super.__fetch(url, option);
        if(result.code){
            this.log(option);
            this.error(`${option.method??'GET'} ${this.opt.httpHost+url} fail:${JSON.stringify(result)}`);
        }
        return result;
    }
    static #toSymbol(symbol){
        const s = symbol.toUpperCase().split('-');
        return s[0]+s[1];
    }
}

module.exports = Binance;