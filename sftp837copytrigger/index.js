const mainFunction = require("../src/sftpcopy.js")

module.exports = async function (context, req) {
 try{
    await mainFunction(context,req)
    .then(() => console.log('Function execution completed'))
 }catch(err){
    context.log("---Error", err)
    context.res = {
      status:500,
      body: err.message
   }
 }
}