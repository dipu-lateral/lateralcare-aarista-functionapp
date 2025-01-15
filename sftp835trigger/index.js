const mainFunction = require("../src/835filecopy.js")

module.exports = async function (context,req) {
 try{
    await mainFunction(context,req)
 }catch(err){
    context.log("---Error", err)
 }
}