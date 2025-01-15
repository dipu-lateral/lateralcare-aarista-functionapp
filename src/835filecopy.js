const {DefaultAzureCredential} = require('@azure/identity');
const secretClient = require("@azure/keyvault-secrets")
const config = require('../config.json');
const utils = require('./utils.js')

const keyVault = config.keyVaultUrl
const pattern = /(?<=~)ST\*.*?~SE\*(.*?)~/gs;
const credential = new DefaultAzureCredential() 
const client = new secretClient.SecretClient(keyVault,credential)
const storage835DestinationPath = config.storage835DestinationPath
const clientId = config.clientId

const sftpConnections = config.sftpConnections

/**
 * Method to get the header of the 835 file.
 * This function extracts the header from the 835 file.
 * @param {*} content 
 * @returns 
 */
function getHeader(content){
    lastIndex = content.indexOf("~ST*")
    return content.substring(0, lastIndex + 1)
}

/**
 * Method to get the footer of the 835 file.
 * This function extracts the footer from the 835 file.
 * @param {*} content 
 * @returns 
 */
function getFooter(content){
    firstIndex = content.lastIndexOf("~GE*")
    return content.substring(firstIndex + 1, content.length)
}

async function copy835FromSFTP(context, batchId, runId, isManualRemittance){
    const ediFormat = isManualRemittance ? "manual_835" : "835"
    const matrixSftpConfig = isManualRemittance ? config.sftp : null
    // If not manual remittance, then it will connect with clearing house to get the 835
    return await utils.copyFilesFromAllSFTP_v1(context, batchId, runId, ediFormat, matrixSftpConfig)
}


/**
 * Method to split 835 files into smaller segments.
 * This function splits the 835 files into smaller segments and uploads them to the Azure Blob Storage.
 * @param {*} blob 
 * @param {*} batchId 
 * @param {*} runId 
 */
async function applyTransformation(blob,batchId, runId, isManualRemittance){
    const splitFileDestinationPath = `${storage835DestinationPath}/${batchId}/${runId}/input/`;
    const localFileName = blob.name
    const remoteFileName = localFileName.substring(localFileName.lastIndexOf('/') + 1,localFileName.lastIndexOf('.'));
    console.log(`Downloading blob for EDI split: ${localFileName}`);
    const ediText = await utils.getBlobContent(localFileName)

    if(!isManualRemittance){
        await applyTransformation835(ediText,splitFileDestinationPath, remoteFileName)
    }else{
        await applyTransformation835Manual(ediText,splitFileDestinationPath, remoteFileName)
    }

}

async function applyTransformation835Manual(ediText,splitFileDestinationPath,remoteFileName){
    let transformedEdi = ediText.replace(/\r?\n/g, '').replace(/>/g, ':')
    blobName = splitFileDestinationPath + remoteFileName + "-M" +  ".ARA"
    await utils.createBlob(blobName, transformedEdi)
}

async function applyTransformation835(ediText,splitFileDestinationPath,remoteFileName){
    headerSegment = getHeader(ediText)
    footerSegment = getFooter(ediText)

    const matches = [];
    let match;
    while ((match = pattern.exec(ediText)) !== null) {
        const textBetween = match[0]
        if(textBetween){
            matches.push(textBetween.trim());
        }
    }

    let count = 1
    for(segment of matches){
        transformedEdi = headerSegment + segment + footerSegment
        blobName = splitFileDestinationPath + remoteFileName + "-" + count+ ".ARA"
        await utils.createBlob(blobName, transformedEdi)
        count += 1   
    }
}


/**
 * Method to split 835 files into smaller segments.
 * This function splits the 835 files into smaller segments and uploads them to the Azure Blob Storage.
 * @param {*} context 
 * @param {*} batchId 
 * @param {*} runId 
 */
async function split835Files(context,batchId, runId, isManualRemittance){
    console.log("=============SPLIT 835 FILES==============")
    context.log("=============SPLIT 835 FILES==============")
    const blobPrefix = `${storage835DestinationPath}/${batchId}/${runId}/sftp/`;
    const blobs = await utils.getFilesFromBlob(blobPrefix)
    const promises =  blobs.entries.map(async(blob) => {
        await applyTransformation(blob, batchId, runId, isManualRemittance)
    });

    await Promise.all(promises)
}

/**
 * Method to trigger the ADF pipeline for 835 files.
 * This function creates an ADF run and triggers the ADF pipeline for the given batch and run.
 * @param {*} context 
 * @param {*} batchId 
 * @param {*} runId 
 */
async function trigger835ADFPipeline(context, batchId, runId){
    //Create ADF Run
    const payload = {
        "tenantId":clientId,
        "batchId":batchId,
        "runId": runId
    }
    await utils.triggerADFPipeline(context, payload, "835")
}

/**
 * Method to process 835 files after they've been read from the SFTP server.
 * This function splits the files, prepares them for further processing,
 * and triggers the ADF pipeline for the given batch and run.
 * @param {*} context 
 * @param {*} batchId 
 * @param {*} runId 
 */
async function processFilesAvailable(context, batchId, runId, isManualRemittance){
    await split835Files(context,batchId, runId, isManualRemittance)
    console.log(`Triggering ADF Pipline for ${batchId}, ${runId}`)
    context.log(`Triggering ADF Pipline for ${batchId}, ${runId}`)
    await trigger835ADFPipeline(context,batchId, runId)
}



/**
 * Main function to handle the processing of 835 files.
 * This function is exported and serves as the entry point for the Azure Function.
 * 
 * @param {Object} context - The Azure Functions context object.
 * @param {Object} req - The HTTP request object.
 * @returns {Promise<void>}
 */

module.exports = async function (context, req) {
    const runId = req.query?.run_id ?? utils.getRunId()
    const batchId = req.query?.batch_id ?? utils.getBatchId()
    const isManualRemittance = req.query?.is_manual ?? false
    console.log("Run ID:" + runId + ", BatchId:"+batchId)
    context.log("Run ID:" + runId + ", BatchId:"+batchId)
    const {isFileAvailable, runStatusArr} = req.query?.run_id ? {"isFileAvailable":true,"runStatusArr":[]} : await copy835FromSFTP(context,batchId, runId, isManualRemittance)
    console.log("========SFTP CONNECTION SUMMARY===========")
    context.log("========SFTP CONNECTION SUMMARY===========")
    console.log(runStatusArr)
    context.log(runStatusArr)
    if(isFileAvailable){
        await processFilesAvailable(context,batchId, runId, isManualRemittance)
    }
    utils.validateRunStatus(runStatusArr)
}