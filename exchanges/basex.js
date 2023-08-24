const fetch = require('node-fetch');
global.debug = (process.argv.indexOf('-d') > -1);

/**
 * @class
 */
class Basex{
    static CACHE_TIME = 60000;
    static DEPTH_CACHE_TIME = 1000;

    /**
     * @constructor
     * @param {object} option
     * @param {string} option.httpHost
     * @param {string} option.wssHost
     * @param {number} [option.depthLimit = 20] - limit of depth
     */
    constructor(option) {
        this.opt = {...{depthLimit:20},...option};
        this.name = this.constructor.name;
        this.__symbols = {updateTime:0, symbols:{}};
        this.__depths = {};
    }
    log(...args){
        if(!global.debug) return;
        console.log(...[...[`<${this.name}>`], ...args]);
    }
    error(...args){
        console.error(...[...[`<${this.name}>`], ...args]);
    }
    trace(...args){
        console.trace(...[...[`<${this.name}>`], ...args]);
    }
    async __fetch(uri, option = {}){
        if(!option.method) option.method = 'GET';
        let timeout;
        if(option.timeout){
            const controller = new AbortController();
            timeout = setTimeout(()=>{
                controller.abort();
            }, option.timeout);
        }
        const url = this.opt.httpHost + uri;
        let text = '';
        try{
            this.log(`${option.method} ${url}, ${JSON.stringify(option)}`);
            const response = await fetch(url, option);
            this.log(`${option.method} ${url} ${response.statusText} #${response.status}`);
            text = await response.text();
            if(response.headers.get('content-type').indexOf('application/json') > -1){
                return {code:0, data:JSON.parse(text)}
            }
            return {code:-1, msg:text};
        }catch (e) {
            this.error(`Fail to fetch ${url}:${e.toString()}`);
            return {code:-1, msg:'Timeout'};
        }finally{
            clearTimeout(timeout);
        }
    }

    /**
     * @abstract
     * @returns {Promise<void>}
     * @private
     */
    async __refreshSymbols(){throw 'No implement function'}

    /**
     * @abstract
     * @param {string} baseAsset
     * @param {string} quoteAsset
     * @returns {Promise<void>}
     * @private
     */
    async __refreshDepth(baseAsset, quoteAsset){throw 'No implement function'}
    /**
     * get symbol or symbols of exchange
     * @param {string} [baseAsset] - BTC etc.
     * @param {string} [quoteAsset] - USDT etc.
     * @returns {Promise<object>}
     */
    async querySymbols(baseAsset, quoteAsset){
        if(Date.now() - this.__symbols.updateTime > Basex.CACHE_TIME){
            await this.__refreshSymbols();
        }
        if(baseAsset && quoteAsset){
            return this.__symbols.symbols[baseAsset.toUpperCase()+'-'+quoteAsset.toUpperCase()];
        }
        return this.__symbols;
    }

    /**
     * @typedef {Object} depth
     * @property {number} updateTime
     * @property {array} asks - [[price,quantity]]
     * @property {array} bids - [[price,quantity]]
     */
    /**
     * get depth by baseAsset and quoteAsset
     * @param {string} baseAsset - BTC etc.
     * @param {string} quoteAsset - USDT etc.
     * @returns {Promise<depth>}
     */
    async queryDepth(baseAsset, quoteAsset){
        baseAsset = baseAsset.toUpperCase();
        quoteAsset = quoteAsset.toUpperCase();
        if(!await this.querySymbols(baseAsset, quoteAsset)) return null;
        const symbol = baseAsset+'-'+quoteAsset;
        if(!this.__depths[symbol]) this.__depths[symbol] = {refresh:'rest', updateTime:0, depth:{asks:[], bids:[]}}
        const depth = this.__depths[symbol];
        if(depth.refresh === 'rest' && Date.now() - depth.updateTime > Basex.DEPTH_CACHE_TIME){
            await this.__refreshDepth(baseAsset, quoteAsset);
        }
        return {updateTime:depth.updateTime, asks:depth.depth.asks, bids:depth.depth.bids};
    }
}
module.exports = Basex;