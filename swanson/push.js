"use strict";

var fs = require('fs');
var exec = require('child_process').exec;
var path = require('path');
var env = require('../env');
var api = require('../api');

var log = api.log.create('swanson-push');
var buildQueue = require('./buildQueue.js');

var args = process.argv.slice(2);
var json = JSON.parse(args[0]);

//	The github repo clone url
//
var cloneUrl = json[1];

//	The directory of the repo that is being watched/changed
//
var sourceDir = json[2];

//	The directory into which test clones are pulled and built
//
var cloneDir = json[0];

//	What was removed, modified or added
//
var commits = json[3];

var cloneRepo = function(cb) {
	var command = 'git clone ' + cloneUrl + ' ' + cloneDir;
	log.info('*CLONING: ' + command);
	exec(command, cb);
};

var enterAndBuild = function(cb) {
	var command = 'cd ' + cloneDir + ';npm i; gulp init;npm test';
	log.info('*BUILDING: ' + command);
	exec(command, cb);
};

//	Run through the #cloneDir and move all files/folders that have changed
//
var move = function(cb) {

	var removing = commits.removed;
	//	Both modified and added
	//
	var adding = commits.modified.concat(commits.added);
	
	var removeCommands = [];
	var addCommands = [];
	var command = [];
	
	//	remove commands are simple rm's
	//	add || modify we rm from source, and replace with newly built files
	//
	removing.forEach(function(f) {
		removeCommands.push(
			'rm -rf ' + sourceDir + '/' + f
		);
	});
	
	adding.forEach(function(f) {
		addCommands.push(
			'rm -rf ' + sourceDir + '/' + f,
			'mv ' + cloneDir + '/' + f + ' ' + sourceDir + '/' + f
		);
	});
	
	//	Just creating a long string of ;-separated commands for #exec
	//
	removeCommands.length && command.push(removeCommands.join(';'));
	addCommands.length && command.push(addCommands.join(';'));
	
	//	We always move the build folder
	//
	command.push('rm -rf ' + sourceDir + '/' + env.BUILD_DIR + '; mv ' + cloneDir + '/' + env.BUILD_DIR + ' ' + sourceDir + '/' + env.BUILD_DIR);
	
	command = command.join(';');

	log.info('*MOVING: ' + command);

	exec(command, cb);
};

//	Clones do NOT have a bin/.config.json file (.gitignore'd).
//	This is generated by individual builds. Use our local version to
//	build/test. Note that the server is not started during this process,
//	so locally-unique port and other settings aren't used, and this
//	generated config file will never be copied into production.
//
var prepareClone = function(cb) {
	var command = cloneDir + '/bin/.config.json';
	fs.writeFile(command, JSON.stringify(env), cb);
	log.info("*WRITING CONFIG: " + command);
};

var cleanAndRestart = function() {	

	//	Done, inform buildQueue.
	//
	buildQueue.complete().then(function() {
		log.info("*CLEANING AND RESTARTING");
		var command = 'rm -rf ' + cloneDir + ';pm2 gracefulReload ' + env.PM2_PRODUCTION_NAME;
		exec(command);
		
	}).catch(function(err) {
		log.error(err);
	});
};

//	The action -- clone, build, move, restart
//
cloneRepo(function(err) {
	if(err) {
		return log.error(err);
	}
	prepareClone(function(err) {
		if(err) {
			return log.error(err);
		}
		enterAndBuild(function(err, data) {
			if(err) {
				return log.error(err);
			}
			move(function(err) {
				if(err) {
					return log.error(err);
				}
				cleanAndRestart();
			});
		});
	});
});

