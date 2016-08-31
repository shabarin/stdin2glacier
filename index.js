#!/usr/bin/env node

"use strict";

var fs = require('fs');
var crypto = require('crypto');
var AWS = require('aws-sdk');
var glacier;
var sequentalreader = require('sequentalreader');

var pjson = require('./package.json');

var program = require('commander');
program
    .version(pjson.version)
    .arguments('<file>')
    .usage('[options] <file> (use `-` for stdin)')
    .option('-s, --part-size <part-size>', 'Part size to use during upload (default 1Mb)', 1*1024*1024)
    .option('-r, --region <region>', 'AWS region (e.g. eu-central-1)')
    .option('-v, --vault-name <vault-name>', 'Vault name')
    .option('-d, --description <description>', 'Archive description')
    .action((file) => {
        AWS.config.region = program.region;
        AWS.config.apiVersions.glacier = '2012-06-01';
        AWS.config.httpOptions.timeout = 300000;
        /* global ok */ glacier = new AWS.Glacier();
        doUpload(file);
    })
    .parse(process.argv);



const hashChunkSize = 1024 * 1024;

/**
 * Adds to state.hashArr[] hashes of file uploading, split by 1024*1024 parts, as described in
 * http://docs.aws.amazon.com/cli/latest/userguide/cli-using-glacier.html
 *
 * This is where chunk size is always 1024*1024, no matter what the partSize is.
 * @param state
 * @param data
 */
function addPartsHashes(state, data) {
    for (var i = 0; i < data.length; i += hashChunkSize) {
        var chunk = data.slice(i, Math.min(i + hashChunkSize, data.length));
        var hash = crypto.createHash('sha256');
        hash.update(chunk);
        state.hashArr.push(hash.digest());
    }
}

/**
 * Calculates a treeHash of array of 1024*1024 chunk hashes
 * @param hashArr
 * @returns String hexadecimal
 */
function calculateTreeHash(hashArr) {
    if (hashArr.length == 1) return hashArr[0].toString('hex');
    var newArr = [];
    var hashPair;
    for (var i = 0; i < hashArr.length; i += 2) {
        if (hashArr[i + 1]) {
            hashPair = Buffer.concat([hashArr[i], hashArr[i + 1]], 64);
            var hash = crypto.createHash('sha256');
            hash.update(hashPair);
            newArr.push(hash.digest());
        } else {
            newArr.push(hashArr[i]);
        }
    }
    return calculateTreeHash(newArr);
}

function processData(state, data, partNum) {
    return new Promise((resolve, reject) => {
        addPartsHashes(state, data);

        var checksum = glacier.computeChecksums(data).treeHash;

        var params = {
            accountId: '-',
            uploadId: state.uploadId,
            vaultName: program.vaultName,
            body: data,
            checksum: checksum,
            range: 'bytes ' + partNum * state.partSize + '-' + Math.min(
                partNum * state.partSize + state.partSize - 1,
                partNum * state.partSize + data.length - 1
            ) + '/*',
        };

        glacier.uploadMultipartPart(params, function (err, data) {
            if (err) return reject(err);
            else {
                console.log("Successfully uploaded part %d", partNum);
                resolve(state);
            }
        });
    });
}

function loopRead(state, partNum) {
    return new Promise((resolve, reject) => {

        console.log('Processing part %d...', partNum);
        state.readNext(state.partSize)
            .then((data) => {
                if (data === null) {
                    // end of file
                    resolve(state);
                } else {
                    state.archiveSize += data.length;
                    processData(state, data, partNum)
                        .then(() => loopRead(state, partNum + 1))
                        .then(() => resolve(state))
                        .catch((e) => reject(e));
                }
            })
            .catch((e) => {
                reject(e);
            });
    });
}

function initiateUpload(state) {
    return new Promise((resolve, reject) => {
        var params = {
            accountId: '-',
            vaultName: program.vaultName, // @todo change
            archiveDescription: program.description,
            partSize: state.partSize.toString(),
        };
        glacier.initiateMultipartUpload(params, function (err, data) {
            if (err) return reject(err);
            else {
                state.uploadId = data.uploadId;
                resolve(state);
            }
        });
    });
}

function completeMultipartUpload(state) {
    return new Promise((resolve, reject) => {
        var params = {
            accountId: '-',
            uploadId: state.uploadId.toString(),
            vaultName: program.vaultName,
            archiveSize: state.archiveSize.toString(),
            checksum: state.checksum,
        };
        glacier.completeMultipartUpload(params, function (err, data) {
            if (err) return reject(err);
            else resolve(data);
        });
    });
}

function doUpload(filename) {

    var fStream = filename === '-' ? process.stdin : fs.createReadStream(filename, {encoding: null});

    Promise.resolve()
        .then(() => initiateUpload({partSize: program.partSize}))
        .then((state) => {
            state.hashArr = [];
            state.archiveSize = 0;
            state.readNext = sequentalreader(fStream);
            return loopRead(state, 0);
        })
        .then((state) => {
            state.checksum = calculateTreeHash(state.hashArr);
            return state;
        })
        .then((state) => {
            return completeMultipartUpload(state);
        })
        .then((result) => {
            console.log('Archive successfully uploaded.');
            console.log(result);
        })
        .catch((e) => {
            console.log("ERROR");
            console.log(e);
            console.log(e.stack);
        });
}
