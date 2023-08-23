const Basex = require('./basex');
const crypto = require("crypto");
class Binance extends Basex{
    /**
     * create an instance of binance
     * @param option
     * @param {string} [option.httpHost="https://api.binance.com"] - host for REST API
     * @param {string} [option.wssHost="wss://stream.binance.com:9443"] - host for WebSocket
     * @param {object} [option.auth] - authentication
     * @param {string} option.auth.access - access id
     * @param {string} option.auth.secret - secret key
     */
    constructor(option={}) {
        option = {...{httpHost:'https://api.binance.com', wssHost:'wss://stream.binance.com:9443'}, ...option};
        super(option);
    }
    async __querySymbols(){
        const query = {};
        const result = await this.#fetch('/api/v3/exchangeInfo', query);
        if(result.code !== 0) return;

        this.__symbols.updateTime = Date.now();
        for(const s of result.data.symbols){
            const ss = s['baseAsset']+'-'+s['quoteAsset'];
            this.__symbols.symbols[ss] = {symbol:ss, exSymbol:s.symbol, time:this.__symbols.updateTime};
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
        return await super.__fetch(uri+queryString, option);
    }
    static #toSymbol(symbol){
        const s = symbol.toUpperCase().split('-');
        return s[0]+s[1];
    }
}

module.exports = Binance;