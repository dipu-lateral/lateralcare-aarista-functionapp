const config = require('../config.json');
const utils = require('./utils.js')

const clientId = config.clientId
const sftpConnections = config.sftpConnections


async function copy999FromSFTP(context, batchId, runId){
    let isFileAvailable = false
    for (const connection in sftpConnections){
        const files = await utils.copyFilesFromSFTP(context, connection, "999", batchId, runId)
        if(files && !isFileAvailable && files && files.length > 0){
            isFileAvailable = true
        }
    }
    return isFileAvailable
}

async function trigger999ADFPipeline(context, batchId, runId){
    //Create ADF Run
    const payload = {
        "tenant_id":clientId,
        "batch_id":batchId,
        "run_id": runId
    }
    await utils.triggerADFPipeline(context, payload, "999")
}


module.exports = async function (context, req) {
    try {
        const runId = req.query?.run_id ?? utils.getRunId()
        const batchId = req.query?.batch_id ?? utils.getBatchId()
        console.log("Run ID:" + runId + ", BatchId:"+batchId)
        context.log("Run ID:" + runId + ", BatchId:"+batchId)
        const isFileAvailable = req.query?.run_id ? true : await copy999FromSFTP(context,batchId, runId)
        if(isFileAvailable){
            await trigger999ADFPipeline(context,batchId, runId)
        }
    }catch(error){
        console.log("Error:" + error.stack)
        context.log("Error:" + error.stack)
    }
}