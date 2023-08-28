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
        /**
         * @protected
         * @type {{depthLimit: (number|number), wssHost: string, httpHost: string}}
         */
        this.opt = {...{depthLimit:5},...option};
        /**
         * @private
         */
        this.name = this.constructor.name;
        this.__enable = {depthWss:true, accountWss:true};
        this.__symbols = {updateTime:0, symbols:{}};
        this.__depths = {};
        this.__wsPublic = null;
        this.__wsPrivate = null;
        this.__events = {};
        this.__syncing = false;
        this.__account = {refresh:'wss', updateTime:0, balances:{}};
    }

    /**
     * register an event on callback
     * @param {("depth"|"balance"|"order")} event - event
     * @param {function} func - callback function
     * @public
     */
    on(event, func){
        this.__events[event] = func;
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
     * subscribe a depth of symbol on websocket
     * @param {string} baseAsset
     * @param {string} quoteAsset
     * @returns {Promise<boolean>}
     * @public
     */
    async subscribeDepth(baseAsset, quoteAsset){
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
        if(!this.__wsPublic){
            await this.__startWebSocket();
            return true;
        }
        return await this.__subscribeDepth(s.symbol);
    }

    /**
     * subscribe account information by websocket
     * @returns {Promise<boolean>}
     */
    async subscribeAccount(){
        if(!this.__enable.accountWss){
            this.error(`Not support Account on WebSocket`);
            return false;
        }
        this.__account.refresh = 'wss';
        if(!this.__wsPrivate){
            await this.__startPrivateWebSocket();
            return true;
        }
    }

    /**
     * query an or all assets balances
     * @param asset
     * @returns {Promise<{}|*>}
     */
    async queryAssets(asset){
        if(!asset) return this.__account.balances;
        return this.__account.balances[asset];
    }
    /**
     * destroy by test, programmer don't need call it
     * @public
     */
    destroy(){
        this.log(`Destroy`);
        this.__syncing = false;
        this.__wsPublic.close();
    }

    /**
     * write log on debug
     * @protected
     * @param {any} args
     */
    log(...args){
        if(!global.debug) return;
        console.log(...[...[`<${this.name}>`], ...args]);
    }
    /**
     * write error on during
     * @protected
     * @param {any} args
     */
    error(...args){
        console.error(...[...[`<${this.name}>`], ...args]);
    }
    /**
     * write trace log for bugfix
     * @protected
     * @param {any} args
     */
    trace(...args){
        console.trace(...[...[`<${this.name}>`], ...args]);
    }

    /**
     * http request
     * @param {string} uri - uri string without host
     * @param {object} option - option for http request
     * @param {("GET"|"POST"|"DELETE"|"PUT")} [option.method="GET"] - method of http request
     * @param {object} [option.headers] - headers of http request
     * @param {number} [option.timeout=10000] - timeout of http request
     * @returns {Promise<{msg: (*|string), code: number}|{msg: string, code: number}|{code: number, data: any}>}
     * @protected
     */
    async __fetch(uri, option = {}){
        if(!option.method) option.method = 'GET';
        const controller = new AbortController();
        const timeout = setTimeout(()=>{
            controller.abort();
        }, option.timeout??10000);
        const url = this.opt.httpHost + uri;
        let text = '';
        try{
            this.log(`${option.method} ${url}, ${JSON.stringify(option)}`);
            const response = await fetch(url, option);
            this.log(`${option.method} ${url} ${response.statusText} #${response.status}`);
            text = await response.text();
            if(response.status >= 400){
                return {code:-1, msg:text};
            }
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
     * get symbol object by exchange symbol
     * @param {string} exSymbol - the symbol of exchange, like BTCUSDT or BTC-USDT etc.
     * @returns {*}
     * @protected
     */
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
     * @protected
     * @param {string} symbol - BTC-USDT etc.
     * @returns {Promise<boolean>}
     */
    async __subscribeDepth(symbol){throw 'No implement function'}
    /**
     * @abstract
     * @protected
     * @returns {Promise<string>}
     */
    async __getPrivateWebSocketUri(){throw 'No implement function'}
    /**
     * @abstract
     * @param {WebSocket} ws
     * @param {Buffer} message
     * @returns {Promise<object>}
     * @protected
     */
    async __onMessageWebSocket(ws, message){throw 'No implement function'}

    /**
     * start websocket server
     * @returns {Promise<void>}
     * @private
     */
    async __startWebSocket(){
        const url = this.opt.wssHost;
        const ws = new WebSocket(url);
        this.__wsPublic = ws;
        this.__syncing = true;
        this.log(`Connecting to ${url}...`);
        let self = this;
        ws.on('error', (err)=>{
            self.error(`${self.name} WebSocket connection has error:${err.toString()}`);
        });
        ws.on('close', ()=>{
            self.log(`Closed connection by ${self.__syncing?'peer':'manual'}`);
            ws.removeAllListeners();
            self.__wsPublic = null;
            if(self.__syncing) {
                setTimeout(() => {
                    self.__startWebSocket();
                    self = null;
                }, 1000);
            }
        });
        ws.on('message', async (message)=>{
            const result = await self.__onMessageWebSocket(ws, message);
            if(result && this.__events['depth']){
                this.__events['depth'](result.symbol, result.depth);
            }
        });
        return new Promise(resolve=> {
            ws.on('open', async ()=>{
                self.log(`Connected to ${url}`);
                if(!await self.__onOpenWebSocket(ws)){
                    self.error(`Exception to open depth for ${s.symbol}`);
                    ws.close();
                }
                resolve();
            })
        });
    }
    async __startPrivateWebSocket(){
        const url = this.opt.wssHost+await this.__getPrivateWebSocketUri();
        const ws = new WebSocket(url);
        this.__wsPrivate = ws;
        let self = this;
        ws.on('error', (err)=>{
            self.error(`${self.name} WebSocket private-connection has error:${err.toString()}`);
        });
        ws.on('close', ()=>{
            ws.removeAllListeners();
            self.__wsPrivate = null;
            setTimeout(()=>{
                self.__startPrivateWebSocket();
                self = null;
            }, 1000);
        });
        ws.on('message', async (message)=>{
            const result = await self.__onMessageWebSocket(ws, message);
            if(!result) return;
            if(Array.isArray(result)){
                if(this.__events['balance']){
                    this.__events['balance'](result);
                }
                return;
            }
            if(this.__events['order']){
                this.__events['order'](result);
            }
        });
    }
}
module.exports = Basex;