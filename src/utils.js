const { MultipleErrors } = require('./exceptions/customexceptions.js')
const azureStorage = require('azure-storage');
const {DefaultAzureCredential} = require('@azure/identity');
const { DataFactoryManagementClient } = require("@azure/arm-datafactory");
const secretClient = require("@azure/keyvault-secrets")
const Client = require('ssh2-sftp-client');
const fs = require('fs');
const os = require('os');
const { v4: uuidv4 } = require('uuid');
const config = require('../config.json');
const containerName = config.azureStorageContainerName;
const keyVault = config.keyVaultUrl
const credential = new DefaultAzureCredential() 
const client = new secretClient.SecretClient(keyVault,credential)
const sftpConnections = config.sftpConnections
const copyFileConnections = config.copyFileConnections
const maxRetries = 3
const delay = 1000

let blobService = null

/**
 * Initilaize blob storage object
 * @returns 
 */
async function initBlobService(){
    if (blobService == null){
        const conString = await getSecret(client,"blob-connection-string")
        blobService = azureStorage.createBlobService(conString);
    }
}

async function triggerADFPipeline(context, payload, ediType){
    const pipelineConfig = config.pipelines
    const subscriptionId = pipelineConfig.subscriptionId;
    const resourceGroupName = pipelineConfig.resourceGroupName;
    const dataFactoryName = pipelineConfig.dataFactoryName;
    const pipelineName = pipelineConfig[ediType];

    async function invokePipeline() {
        // Create a DataFactoryManagementClient
        const credentials = new DefaultAzureCredential();
        const client = new DataFactoryManagementClient(credentials, subscriptionId);
        // Trigger the pipeline run
        const response = await client.pipelines.createRun(resourceGroupName, dataFactoryName, pipelineName,{
            parameters:payload
        });
    
        // Log the response
        console.log(`Pipeline ${ediType} run ID:${response.runId}`);
        context.log(`Pipeline ${ediType} run ID:${response.runId}`);
    }

    await invokePipeline()


}

/**
 * Substitute values in template 
 * @param {*} template Template string
 * @param {*} values Array of values
 * @returns 
 */
function formatString(template, values) {
    return template.replace(/{(\d+)}/g, (match, index) => {
        return typeof values[index] !== 'undefined' ? values[index] : match;
    });
}

/**
 * Get all the files from blob with given prefix
 * @param {*} blobPrefix Path prefix
 * @returns 
 */
async function getFilesFromBlob(blobPrefix){
    await initBlobService()
    return await new Promise((resolve, reject) => {
        blobService.listBlobsSegmentedWithPrefix(containerName, blobPrefix,null, (error, result) => {
            if (error) {
                throw error
            } else {
                resolve(result);
            }
        });
    });
}

/**
 * Read the content from Blob
 * @param {*} localFileName 
 * @returns 
 */
async function getBlobContent(localFileName){
    await initBlobService()
    return await new Promise((resolve, reject) => {
            blobService.getBlobToText(containerName, localFileName, (error, result) => {
                if (error) { 
                    throw error
                } else {
                    resolve(result);
                }
        });
    });
}

/**
 * Create blob from content
 * @param {*} blobName Name of the blob
 * @param {*} content text content
 */
async function createBlob(blobName, content){
    await initBlobService()
    await new Promise((resolve, reject) => {
        blobService.createBlockBlobFromText(containerName, blobName, content,(error, result) => {
                if (error) {
                    throw error
                } else {
                    resolve(result);
                }
            });   
        });
}

/**
 * Create date in YYYYMMDD format
 * @returns 
 */
function getBatchId(){
    const currentDate = new Date();
    const year = currentDate.getFullYear();
    const month = String(currentDate.getMonth() + 1).padStart(2, '0'); 
    const day = String(currentDate.getDate()).padStart(2, '0');
    const formattedDate = `${year}${month}${day}`;
    return formattedDate
}

/**
 * Create GUID
 * @returns 
 */
function getRunId(){
    return uuidv4()
}


/**
 * Get the value from KeyVault
 * @param {*} client KeyVault client object
 * @param {*} secretName Key
 * @returns null if value is not found in keyVault
 */
async function getSecret(client,secretName) {
    try {
        const secret = await client.getSecret(secretName);
        return secret.value;
    } catch (error) {
        return null
    }
}

/**
 * Get the directory from which EDI files to be copied
 * @param {*} sftpConfig - SFTP configuration object
 * @param {*} ediFormat - EDI document type
 * @returns EDI file path in SFTP server
 */
async function getSFTPFileSource(sftpConfig,ediFormat){
    const ediConfig = sftpConfig[ediFormat]
    let sourceKey = ediConfig["sourceKey"]
    return await getSecret(client, sourceKey)
}

/**
 * Get the directory from which EDI files to be copied
 * @param {*} sftpConfig - SFTP configuration object
 * @param {*} ediFormat - EDI document type
 * @returns EDI file path in SFTP server
 */
async function getSFTPFileDestination(sftpConfig,ediFormat){
    const ediConfig = sftpConfig[ediFormat]
    let sourceKey = ediConfig["destinationKey"]
    return await getSecret(client, sourceKey)
}

/**
 * Get the storage path where EDI files needs to be stored
 * @param {*} sftpConfig - SFTP configuration object
 * @param {*} ediFormat - EDI document type
 * @returns storage path
 */
function getStorageFileDestination(sftpConfig,ediFormat, batchId, runId){
    const ediConfig = sftpConfig[ediFormat]
    const path =  ediConfig["storageDestination"]
    return formatString(path,[batchId, runId])
}

/**
 * Get the EDI file format
 * @param {*} sftpConfig SFTP configuration object
 * @param {*} ediFormat EDI document type
 * @returns file format
 */
function getEDIFileFormat(sftpConfig,ediFormat){
    const ediConfig = sftpConfig[ediFormat]
    return ediConfig["fileFormat"]
}

/**
 * Checks whether the file format is same
 * @param {*} fileName File name read from SFTP
 * @param {*} fileFormat File format expected
 * @returns True if file format is not defined/file format is matched. False 
 * in all other cases
 */
function canReadFile(fileName,fileFormat){
    if (fileFormat == null || fileFormat == '') return true
    return fileName.toLowerCase().endsWith(fileFormat)
}

/**
 * Checks whether files in SFTP needs to be deleted or not
 * @param {*} sftpConfig SFTP configuration object
 * @returns True/False
 */
function canDeleteAfterRead(sftpConfig, ediFormat){
    ediConfig = sftpConfig[ediFormat]
    return ediConfig["deleteAfterRead"]
}

/**
 * Constructs SFTP configuration
 * @param {*} connectionName Connection name
 * @returns SFTP configuration object
 */
async function getSFTPConfig(sftpConfig){
    const host =  await getSecret(client,sftpConfig["hostKey"])
    const username =  await getSecret(client,sftpConfig["usernameKey"])
    const password =  await getSecret(client,sftpConfig["passwordKey"])
    return {
        "host": host,
        "port": 22,
        "username": username,
        "password": password
    }
}

/**
 * Constructs SFTP configuration
 * @param {*} connectionName Connection name
 * @returns SFTP configuration object
 */
async function getSFTPConfigByType(config, ediType, sftpType){
    ediConfig = config[ediType]
    sftpPrefix = ediConfig[sftpType]
    const host =  await getSecret(client,`${sftpPrefix}-sftp-hostname`)
    const username =  await getSecret(client,`${sftpPrefix}-sftp-username`)
    const password =  await getSecret(client,`${sftpPrefix}-sftp-password`)
    return {
        "host": host,
        "port": 22,
        "username": username,
        "password": password
    }
}


/**
 * Copy individual file from SFTP into Blob storage
 * @param {*} context 
 * @param {*} fileName File name from SFTP
 * @param {*} sftpSource SFTP file source
 * @param {*} storageDestinationPath Blob storage path
 * @param {*} batchId Batch Id YYYYMMDD format 
 * @param {*} runId Run Id Unique identifier for the run
 * @param {*} deleteAfterRead boolean flag to delete files after read
 */
async function copyFile(context, fileName, sftp, sftpSource, storageDestinationPath, deleteAfterRead){
    const localTempDirectory = os.tmpdir();
    const remoteFilePath = `${sftpSource}/${fileName}`;
    // Use the system's temporary directory
    const localFilePath = `${localTempDirectory}/${fileName}`; 
    // Download file from SFTP server
    await sftp.get(remoteFilePath, localFilePath);
    console.log(`File downloaded: ${fileName}`);
    context.log(`File downloaded: ${fileName}`);
    const filePath = `${storageDestinationPath}/${fileName}`;
    console.log(`File path: ${filePath}`)
    context.log(`File path: ${filePath}`)
    await initBlobService()
    // Upload file to Azure Blob Storage
    await new Promise((resolve, reject) => {
        blobService.createBlockBlobFromLocalFile(containerName, filePath, localFilePath, (error, result) => {
            if (error) {
                reject(error);
            } else {
                resolve(result);
            }
        });
    });
    console.log(`File uploaded to Azure Blob Storage: ${fileName}`);
    context.log(`File uploaded to Azure Blob Storage: ${fileName}`);

    if(deleteAfterRead) {
        await sftp.delete(remoteFilePath);
        console.log(`File deleted from SFTP server: ${remoteFilePath}`);
        context.log(`File deleted from SFTP server: ${remoteFilePath}`);
    }
    
    

    // Delete local file
    fs.unlinkSync(localFilePath);
    console.log(`Local file deleted: ${localFilePath}`);
    context.log(`Local file deleted: ${localFilePath}`);
}

/**
 * Check whether delete file is enabled after read from SFTP source
 * @param {*} sftpConfig 
 * @returns 
 */
function isConnectionEnabled(sftpConfig, ediFormat){
    const ediConfig = sftpConfig[ediFormat]
    return ediConfig && ediConfig["enabled"]
}

/**
 * Method to establish sftp connection. Retry logic is added to handle the 
 * timeout error
 * @param {*} sftp  
 * @param {*} config 
 */
async function establishSFTPConnection(sftp,config){
    try{
        await sftp.connect(config);
    }catch(error){
        console.log(`Attempt ${maxRetries} failed with error: ${error.message}. Waiting ${delay} ms before retrying.`)
        if(maxRetries < 3) {
            await new Promise(resolve => setTimeout(resolve, delay));
            delay = delay * 3
            maxRetries++
            await establishSFTPConnection(sftp,config)
        }else{
            throw new Error(`All retries failed with error:${error.stack}`);
        }
    }
}

/**
 * Copy all files from SFTP source path to blob storage
 * @param {*} context 
 * @param {*} sftpConfig SFTP configuration object
 * @param {*} ediType EDI document type
 * @param {*} batchId batch Id YYYYMMDD format
 * @param {*} runId unique identifier for current run
 * @param {*} connectionConfig pass sftp configuration as it is 
 * @returns 
 */
async function copyFilesFromSFTP(context,connectionName,ediType, batchId, runId, connectionConfig = null){
    const config = sftpConnections[connectionName]
    if(!isConnectionEnabled(config, ediType)) {
        console.log(`=====SFTP not enabled for ${connectionName} - ${ediType}=====`)
        context.log(`=====SFTP not enabled for ${connectionName} - ${ediType}=====`)
        return null
    }
    console.log(`=====Read files from ${connectionName} SFTP=====`)
    context.log(`=====Read files from ${connectionName} SFTP=====`)
    const sftp = new Client();
    try{
        
        // Connect SFTP
        const sftpConfig = connectionConfig ?? await getSFTPConfig(config)
        // await sftp.connect(sftpConfig);
        await establishSFTPConnection(sftp, sftpConfig)
        const sftpSource = await getSFTPFileSource(config,ediType) ?? ""
        const fileList = await sftp.list(sftpSource);

        //Get metainfo to read SFTP
        const fileFormat = getEDIFileFormat(config, ediType)
        const storageDestinationPath = getStorageFileDestination(config, ediType, batchId, runId)
        const deleteAfterRead = canDeleteAfterRead(config, ediType)
        let fileNames = []

        //Parallel file read from SFTP 
        // const promises =  fileList.map(async(file) => {
        //     const fileName = file.name;
        //     if(canReadFile(fileName, fileFormat)){
        //         fileNames.push(fileName);
        //         await copyFile(context, fileName, sftp, sftpSource, storageDestinationPath, deleteAfterRead)
        //     } else {
        //         console.log("No files available")
        //         context.log("No files available")
        //     }
        // });

        // await Promise.all(promises)

        //Read files from SFTP
        for (const file of fileList) {
            const fileName = file.name;
            if(canReadFile(fileName, fileFormat)){
                fileNames.push(fileName);
                await copyFile(context, fileName, sftp, sftpSource, storageDestinationPath, deleteAfterRead)
            } else {
                console.log("No files available")
                context.log("No files available")
            }
        }
        fileCount = fileNames.length
        console.log("===== No. of files read:" + fileCount + " =====")
        context.log("===== No. of files read:" + fileCount + " =====")
        return fileNames
    }catch(error){
        throw error
    }finally{
        await sftp.end()
    }
}

/**
 * Copy all files from SFTP source path to blob storage
 * @param {*} context 
 * @param {*} sftpConfig SFTP configuration object
 * @param {*} ediType EDI document type
 * @param {*} batchId batch Id YYYYMMDD format
 * @param {*} runId unique identifier for current run
 * @param {*} connectionConfig pass sftp configuration as it is 
 * @returns 
 */
async function copyFilesFromSFTP_v1(context,connectionName,ediType, batchId, runId, connectionConfig = null){
    let runStatus = {"connectionName":connectionName}
    let fileNames = []
    let fileList = []
    const config = sftpConnections[connectionName]
    if(!isConnectionEnabled(config, ediType)) {
        console.log(`=====SFTP not enabled for ${connectionName} - ${ediType}=====`)
        context.log(`=====SFTP not enabled for ${connectionName} - ${ediType}=====`)
        runStatus["status"] = "NOT_ENABLED"
        runStatus["filesCount"] = 0
        runStatus["fileReadSoFar"] = 0
        return runStatus
    }
    console.log(`=====Read files from ${connectionName} SFTP=====`)
    context.log(`=====Read files from ${connectionName} SFTP=====`)
    const sftp = new Client();
    try{
        // Connect SFTP
        const sftpConfig = connectionConfig ?? await getSFTPConfig(config)
        await establishSFTPConnection(sftp, sftpConfig)
        const sftpSource = await getSFTPFileSource(config,ediType) ?? ""
        fileList = await sftp.list(sftpSource);

        //Get metainfo to read SFTP
        const fileFormat = getEDIFileFormat(config, ediType)
        const storageDestinationPath = getStorageFileDestination(config, ediType, batchId, runId)
        const deleteAfterRead = canDeleteAfterRead(config, ediType)
        

        //Read files from SFTP
        for (const file of fileList) {
            const fileName = file.name;
            if(canReadFile(fileName, fileFormat)){
                fileNames.push(fileName);
                await copyFile(context, fileName, sftp, sftpSource, storageDestinationPath, deleteAfterRead)
            }
        }
        fileCount = fileNames.length
        console.log("===== No. of files read:" + fileCount + " =====")
        context.log("===== No. of files read:" + fileCount + " =====")
        runStatus["status"] = "SUCCESS"
        runStatus["filesCount"] = fileList.length
        runStatus["fileReadSoFar"] = fileNames.length
    }catch(error){
        runStatus["status"] = "FAILURE"
        runStatus["filesCount"] = fileList.length
        runStatus["fileReadSoFar"] = fileNames.length
        runStatus["error"] = error
    }finally{
        await sftp.end()
    }
    return runStatus
}

/**
 * Method to read files from all the SFTP servers configured for specific ediType. 
 * This will provide a run summary and exception details if there are any.
 * @param {*} context 
 * @param {*} batchId 
 * @param {*} runId 
 * @param {*} ediType 
 * @returns 
 */
async function copyFilesFromAllSFTP_v1(context, batchId, runId, ediType, connectionConfig = null){
    let isFileAvailable = false
    let runStatusArr = []
    for (const connection in sftpConnections){
        const runStatus = await copyFilesFromSFTP_v1(context, connection, ediType, batchId, runId, connectionConfig)
        const filesReadCount = runStatus.fileReadSoFar ?? 0
        runStatusArr.push(runStatus)
        if(!isFileAvailable && filesReadCount > 0){
            isFileAvailable = true
        }
    }
    return {"isFileAvailable":isFileAvailable,"runStatusArr":runStatusArr}
}

/**
 * Method to filter out the errored SFTP connections and throw exception.
 * @param {*} runStatusArr 
 */
async function validateRunStatus(runStatusArr){
    const errorRunStatus = runStatusArr.filter(runStatus => runStatus.error && runStatus.error !== null)
    if(errorRunStatus.length > 0){
        throw new MultipleErrors(errorRunStatus)
    }
}


/**
 * Copy individual file from SFTP into Blob storage
 * @param {*} context 
 * @param {*} fileName File name from SFTP
 * @param {*} sftpSource SFTP file source
 * @param {*} storageDestinationPath Blob storage path
 * @param {*} batchId Batch Id YYYYMMDD format 
 * @param {*} runId Run Id Unique identifier for the run
 * @param {*} deleteAfterRead boolean flag to delete files after read
 */
async function copyFileToSFTP(context, fileName, sourceSftp, sftpSourcePath, destinationSftp, destinationsftpPath, deleteAfterRead){
    const remoteFilePath = `${sftpSourcePath}/${fileName}`;
    // Download file from SFTP server
    const stream = await sourceSftp.get(remoteFilePath);
    console.log(`File downloaded: ${fileName}`);
    context.log(`File downloaded: ${fileName}`);
    const filePath = `${destinationsftpPath}/${fileName}`;
    console.log(`File path: ${filePath}`)
    context.log(`File path: ${filePath}`)
    await destinationSftp.put(stream, filePath)
    console.log(`File uploaded to SFTP : ${fileName}`);
    context.log(`File uploaded to SFTP : ${fileName}`);
    if(deleteAfterRead) {
        await sftp.delete(remoteFilePath);
        console.log(`File deleted from SFTP server: ${remoteFilePath}`);
        context.log(`File deleted from SFTP server: ${remoteFilePath}`);
    }
}

/**
 * Copy all files from SFTP source path to another SFTP path
 * @param {*} context 
 * @param {*} sftpConfig SFTP configuration object
 * @param {*} ediType EDI document type
 * @param {*} batchId batch Id YYYYMMDD format
 * @param {*} runId unique identifier for current run
 * @param {*} connectionConfig pass sftp configuration as it is 
 * @returns 
 */
async function copyFilesAcrossSFTP(context,connectionName,ediType){
    const config = copyFileConnections[connectionName]
    if(!isConnectionEnabled(config, ediType)) {
        console.log(`=====SFTP not enabled for ${connectionName} - ${ediType}=====`)
        context.log(`=====SFTP not enabled for ${connectionName} - ${ediType}=====`)
        return null
    }
    console.log(`=====Read files from ${connectionName} SFTP=====`)
    context.log(`=====Read files from ${connectionName} SFTP=====`)
    const sourceSftp = new Client();
    const destinationSftp = new Client();
    try{
        
        // Connect SFTP
        const sourceSftpConfig = await getSFTPConfigByType(config, ediType, "source")
        const destinationSftpConfig = await getSFTPConfigByType(config, ediType, "destination")

        // await sftp.connect(sftpConfig);
        await establishSFTPConnection(sourceSftp, sourceSftpConfig)
        await establishSFTPConnection(destinationSftp, destinationSftpConfig)

        const sftpSourcePath = await getSFTPFileSource(config,ediType) ?? ""
        const fileList = await sourceSftp.list(sftpSourcePath);

        const sftpDestinationPath = await getSFTPFileDestination(config,ediType) ?? ""

        //Get metainfo to read SFTP
        const fileFormat = getEDIFileFormat(config, ediType)
        const deleteAfterRead = canDeleteAfterRead(config, ediType)
        let fileNames = []

        //Read files from SFTP
        for (const file of fileList) {
            const fileName = file.name;
            if(canReadFile(fileName, fileFormat)){
                fileNames.push(fileName);
                await copyFileToSFTP(context, fileName, sourceSftp, sftpSourcePath, destinationSftp, sftpDestinationPath, deleteAfterRead)
            } else {
                console.log("No files available")
                context.log("No files available")
            }
        }
        fileCount = fileNames.length
        console.log("===== No. of files read:" + fileCount + " =====")
        context.log("===== No. of files read:" + fileCount + " =====")
        return fileNames
    }catch(error){
        throw error
    }finally{
        await sourceSftp.end()
        await destinationSftp.end()
    }
}

module.exports = {
    copyFilesFromSFTP,
    initBlobService,
    getRunId,
    getBatchId,
    getFilesFromBlob,
    getBlobContent,
    createBlob,
    triggerADFPipeline,
    copyFilesFromSFTP_v1,
    copyFilesFromAllSFTP_v1,
    validateRunStatus,
    copyFilesAcrossSFTP
}

