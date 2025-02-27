// const processSftpFiles = require('./sftpcopy.js');
const processSftpFiles = require('./835filecopy.js');

const context = {
    log: console.log,
    done: () => {} 
};

// const request = {
//     query:{
//          "run_id":"32175908-b6a3-4487-8a69-26e4e4c6ec21",
//          "batch_id":"20240808"
//      }
// }; 


// const request = {
//     query:{
//         "sync_id":"12942afd-ff30-48c9-870a-36c3acb12f9d",
//         "clearing_houses":"Waystar",
//         "sync_batch_id":"20250115"
//      }
// };

// const request = {
//     "query" : {
//         // "run_id":"15f28caf-1aad-4b36-865d-07441621a2c1",
//         // "batch_id":"20241029",
//         // "is_manual":false
//     }
// }

const request = {
    query:{
        // "sync_id":"81ea3359-5413-44a7-ab85-9c12320784bd",
        // "clearing_houses":"Waystar",
        // "sync_batch_id":"20250118"
     }
};

processSftpFiles(context,request)
    .then(() => console.log('Function execution completed'))
    .catch(error => console.error('Error occurred:', error));
