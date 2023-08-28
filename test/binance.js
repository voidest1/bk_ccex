const assert = require('chai').assert;
const {Binance} = require('../index');

const bn = new Binance({httpHost:'http://mock:4321/bn', wssHost:'ws://mock:4321/bn/stream'});
describe('TEST:Binance', function (){
    this.timeout(10000);
    it.skip('querySymbols', async ()=>{
        const result = await bn.querySymbols();
        assert.hasAnyKeys(result, ['updateTime', 'symbols']);
        assert.hasAnyKeys(result.symbols, ['BTC-USDT']);
    });
    it.skip('queryDepth', async ()=>{
        const result = await bn.queryDepth('BTC', 'USDT');
        assert.equal(result.asks.length, 5);
        assert.equal(result.bids.length, 5);
    });
    it.skip('subscribeDepth', (done)=>{
        let symbols = {'BTC-USDT':0, 'ETH-USDT':0};
        let duplicated = false;
        bn.on('depth', (symbol, data)=>{
            symbols[symbol] = data.depth.asks.length;
            // console.log(symbol, JSON.stringify(data));
            if(symbols['BTC-USDT'] && symbols['ETH-USDT'] && !duplicated){
                duplicated = true;
                bn.destroy();
                done();
            }
        })
        bn.subscribeDepth('BTC', 'USDT');
        bn.subscribeDepth('ETH', 'USDT');
    });
    it.skip('subscribeAccount', async ()=>{
        await bn.subscribeAccount();
        console.log(await bn.queryAssets('USDT'));
    });
})