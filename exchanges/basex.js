const fetch = require('node-fetch');
const {WebSocket} = require('ws');
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
     * @param {number} [option.depthLimit = 5] - limit of depth
     */
    constructor(option) {
        this.opt = {...{depthLimit:5},...option};
        this.name = this.constructor.name;
        this.__enable = {depthWss:true};
        this.__symbols = {updateTime:0, symbols:{}};
        this.__depths = {};
        this.__ws = null;
        this.__events = {};
        this.__syncing = false;
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
    __getSymbolByEx(exSymbol){
        for(const symbol in this.__symbols.symbols){
            if(this.__symbols.symbols[symbol].exSymbol === exSymbol) return this.__symbols.symbols[symbol];
        }
    }
    /**
     * @abstract
     * @returns {Promise<void>}
     * @protected
     */
    async __refreshSymbols(){throw 'No implement function'}

    /**
     * @abstract
     * @param {string} baseAsset
     * @param {string} quoteAsset
     * @returns {Promise<void>}
     * @protected
     */
    async __refreshDepth(baseAsset, quoteAsset){throw 'No implement function'}

    /**
     * @abstract
     * @param {WebSocket} ws
     * @returns {Promise<boolean>}
     * @protected
     */
    async __onOpenWebSocket(ws){throw 'No implement function'}
    /**
     * @abstract
     * @param {WebSocket} ws
     * @param {Buffer} message
     * @returns {Promise<void>}
     * @protected
     */
    async __onMessageWebSocket(ws, message){throw 'No implement function'}

    /**
     * register an event on callback
     * @param {("updateDepth")} event - event
     * @param {function} func - callback function
     * @public
     */
    on(event, func){
        this.__events[event] = func;
    }
    /**
     * get symbol or symbols of exchange
     * @param {string} [baseAsset] - BTC etc.
     * @param {string} [quoteAsset] - USDT etc.
     * @returns {Promise<object>}
     * @public
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
     * @public
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

    /**
     * start to sync depth by websocket
     * @param {string} baseAsset
     * @param {string} quoteAsset
     * @returns {Promise<boolean>}
     * @public
     */
    async syncDepth(baseAsset, quoteAsset){
        if(!this.__enable.depthWss){
            this.error(`Not support Depth on WebSocket`);
            return false;
        }
        const s = await this.querySymbols(baseAsset, quoteAsset);
        if(!s){
            this.error(`Not support symbol ${baseAsset+'-'+quoteAsset}`);
            return false;
        }
        if(!this.__depths[s.symbol]) this.__depths[s.symbol] = {refresh:'wss', updateTime:0, depth:{asks:[], bids:[]}};
        this.__depths[s.symbol].refresh = 'wss';
        if(!this.__ws){
            const url = this.opt.wssHost;
            const ws = new WebSocket(url);
            this.__ws = ws;
            this.__syncing = true;
            this.log(`Connecting to ${url}...`);
            let self = this;
            ws.on('open', async ()=>{
                self.log(`Connected to ${url}`);
                if(!await self.__onOpenWebSocket(ws)){
                    self.error(`Exception to open depth for ${s.symbol}`);
                    ws.close();
                }
            });
            ws.on('error', (err)=>{
                self.error(`${self.name} WebSocket connection has error:${err.toString()}`);
            });
            ws.on('close', ()=>{
                self.log(`Closed connection by ${self.__syncing?'peer':'manual'}`);
                ws.removeAllListeners();
                self.__ws = null;
                if(self.__syncing) {
                    setTimeout(() => {
                        self.syncDepth(baseAsset, quoteAsset);
                        self = null;
                    }, 1000);
                }
            });
            ws.on('message', async (message)=>{
                await self.__onMessageWebSocket(ws, message);
            });
        }else{

        }
    }

    /**
     * destroy by test, programmer don't need call it
     * @public
     */
    destroy(){
        this.log(`Destroy`);
        this.__syncing = false;
        this.__ws.close();
    }
}
module.exports = Basex;