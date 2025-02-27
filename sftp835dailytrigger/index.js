const mainFunction = require('../src/835filecopy.js')

module.exports = async function (context, myTimer) {
    var timeStamp = new Date().toISOString();
    
    if (myTimer.isPastDue)
    {
        context.log('JavaScript is running late!');
    }
    const req = {

    }
    await mainFunction(context, req)
    context.log('JavaScript timer trigger function ran!', timeStamp);   
};