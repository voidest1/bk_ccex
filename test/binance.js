const {Binance} = require('../index');

const bn = new Binance();
describe('测试', function (){
    it('hi', async ()=>{
        await bn.querySymbols();
        await bn.querySymbols();
    })
})