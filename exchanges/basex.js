const fetch = require('node-fetch');
class Basex{
    static CACHE_TIME = 60000;
    constructor(option) {
        this.opt = option;
        this.name = this.constructor.name;
        this.__symbols = {updateTime:0, symbols:{}};
    }
    log(...args){
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
    async __querySymbols(){throw 'No implement function'}

    /**
     * get symbol or symbols of exchange
     * @param {string} [symbol] - BTC-USDT etc.
     */
    async querySymbols(){
        if(Date.now() - this.__symbols.updateTime > Basex.CACHE_TIME){
            await this.__querySymbols();
        }
        return this.__symbols;
    }
}
module.exports = Basex;