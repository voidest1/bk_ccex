const assert = require('chai').assert;
const {Binance} = require('../index');

const bn = new Binance();//{httpHost:'http://mock:4321/bn', wssHost:'ws://mock:4321/bn'});
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
    it('syncDepth', (done)=>{
        let times = 1;
        bn.on('updateDepth', (symbol, depth)=>{
            if(times++ > 1) return;
            assert.equal(symbol, 'BTC-USDT');
            bn.stopSync();
            done();
        })
        bn.syncDepth('BTC', 'USDT');
    });
})