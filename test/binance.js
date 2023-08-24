const assert = require('chai').assert;
const {Binance} = require('../index');

const bn = new Binance({httpHost:'http://mock:4321/bn', wssHost:'ws://mock:4321/bn'});
describe('TEST:Binance', function (){
    it('querySymbols', async ()=>{
        const result = await bn.querySymbols();
        assert.hasAnyKeys(result, ['updateTime', 'symbols']);
        assert.hasAnyKeys(result.symbols, ['BTC-USDT']);
    });
    it('queryDepth', async ()=>{
        const result = await bn.queryDepth('BTC', 'USDT');
        assert.equal(result.asks.length, 20);
        assert.equal(result.bids.length, 20);
    });
})