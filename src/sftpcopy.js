const azureStorage = require('azure-storage');
const {DefaultAzureCredential} = require('@azure/identity');
const secretClient = require("@azure/keyvault-secrets")
const Client = require('ssh2-sftp-client');
const config = require('../config.json');


const containerName = config.azureStorageContainerName;
const clientId = config.clientId;
const keyVault = config.keyVaultUrl

const credential = new DefaultAzureCredential() 
const client = new secretClient.SecretClient(keyVault,credential)
const sftpConnections = config.sftpConnections


async function getSecret(client,secretName) {
    try {
        const secret = await client.getSecret(secretName);
        return secret.value;
    } catch (error) {
        return null
    }
  }

  function canRun(config){
    return config["enabled"]
  }

async function send837Files(context, runId, batchId, connection){
    const sftp = new Client();
    const config = sftpConnections[connection]
    if(!canRun(config)){
        console.log(`837 not enabled for : ${connection}`);
        context.log(`837 not enabled for : ${connection}`);
        return
    }
    console.log(`========Sending files to clearing house ${connection}========`)
    context.log(`========Sending files to clearing house ${connection}========`)
    try {
        //Read values from keyvault
        const host = await getSecret(client,config["hostKey"])
        const username = await getSecret(client,config["usernameKey"])
        const password = await getSecret(client,config["passwordKey"])
        const sftpDestinationPath = await getSecret(client,config["837destinationKey"]) ?? ""
        //Create SFTP Config
        const sftpConfig = {
            "host": host,
            "port": 22,
            "username": username,
            "password": password
        }

        const conString = await getSecret(client,"blob-connection-string")
        const blobService = azureStorage.createBlobService(conString);
        const blobPrefix = `inbound/${clientId}/generated_837_selective_grouped/${batchId}/${runId}/${connection}/`;
        await sftp.connect(sftpConfig);
        const blobs = await new Promise((resolve, reject) => {
            blobService.listBlobsSegmentedWithPrefix(containerName, blobPrefix, null, (error, result) => {
                if (error) {
                    console.log("Error",error)
                    context.log("Error",error)
                    throw error
                } else {
                    resolve(result);
                }
            });
        });

        console.log(`Total Files available to send ${blobs.entries.length}`);
        context.log(`Total Files available to send ${blobs.entries.length}`);

        intermediatePath = `${sftpDestinationPath}/Waystar${batchId}`
        try {
            await sftp.stat(intermediatePath);
            console.log(`Directory: ${intermediatePath} available`);
        } catch (err) {
            if (err.code === 'ENOENT') {
                await sftp.mkdir(intermediatePath, true);
                console.log(`Created directory: ${intermediatePath}`);
            } else {
                throw err;
            }
        }
        

        for (const blob of blobs.entries) {
            localFileName = blob.name
            console.log(`Downloading blob: ${localFileName}`);
            context.log(`Downloading blob: ${localFileName}`);
            
            remoteFileName = localFileName.substring(localFileName.lastIndexOf('/') + 1);
            const blobStream = blobService.createReadStream(containerName, localFileName);
            console.log(`sftpDestinationPath: ${intermediatePath}, localFileName: ${localFileName}`)
            await sftp.put(blobStream, `${intermediatePath}/${remoteFileName}`);
            console.log(`Downloaded blob ${localFileName}`);
            context.log(`Downloaded blob ${localFileName}`);
        }

    } catch (error) {
        console.log("Error:", error);
        context.log("Error:", error);
        throw error
    } finally {
        await sftp.end();
    }
}

module.exports = async function (context,req) {
    runId = req.query.sync_id
    batchId = req.query.sync_batch_id
    clearingHouses = req.query.clearing_houses
    console.log(`runId ${runId}, batchId: ${batchId}, clearingHouses : ${clearingHouses}`);
    context.log(`runId ${runId}, batchId: ${batchId}, clearingHouses : ${clearingHouses}`);
    if(clearingHouses){
        const promises =  clearingHouses.split(',').map(async(clearingHouse) => {
            await send837Files(context,runId, batchId, clearingHouse.toLowerCase())
        });

        await Promise.all(promises)
    }
};
