const config = require('../config.json');
const utils = require('./utils.js')

const clientId = config.clientId
const sftpConnections = config.sftpConnections


async function copy999FromSFTP(context, ediType){
    let isFileAvailable = false
    const files = await utils.copyFilesAcrossSFTP(context, "aarista", ediType)
    if(files && !isFileAvailable && files && files.length > 0){
        isFileAvailable = true
    }
    return isFileAvailable
}


module.exports = async function (context, req) {
    try {
        const runId = req.query?.run_id ?? utils.getRunId()
        const batchId = req.query?.batch_id ?? utils.getBatchId()
        console.log("Run ID:" + runId + ", BatchId:"+batchId)
        context.log("Run ID:" + runId + ", BatchId:"+batchId)
        const isFileAvailable = req.query?.run_id ? true : await copy999FromSFTP(context,"837")
    }catch(error){
        console.log("Error:" + error.stack)
        context.log("Error:" + error.stack)
    }
}