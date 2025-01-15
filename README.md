# Introduction
Function App Project to maintain all SFTP related operation. Code base contains following functionalities
1. Connection to various SFTP servers
2. Push certain file format into SFTP servers
3. Pull files from SFTP servers
4. File split operation for some of the downstream operations.

# KEEP IN MIND
1. config.json - file used in this project might differ from production version. Usually the deployment are done from local machine. The config.json file is edited manualy during deployment time.
2. Trigger - Trigger are also edited manualy during deployment time.
3. To run the code locally, user needs necessary persmission to the resources. 

# How to test the code locally
1. Clone the repository to a directory
2. Run npm install inside directory
3. test.js file is located under src/ directory. Create custom payload in this file
4. Run node src/test.js

