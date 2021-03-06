var path = require('path');
var conf = require('./lib');
var parsers = require('./parsers');
var lodash = require('lodash');

// write shell scripts
function writeShell(grunt, options, src, cwd, argArr) {
	var dir = options.writeShell;
	if (grunt.file.isFile(options.writeShell)) {
		dir = path.dirname(options.writeShell);
	}

	var gf = path.basename(src.toLowerCase(), path.extname(src));
	var base = path.join(dir, options.target + '__' + gf);

	// beh
	var shPath = base + '.sh';
	var shContent = [
		'#!/bin/bash',
		'',
		'cd ' + path.resolve(cwd),
		'grunt ' + argArr.join(' '),
		''
	].join('\n');
	grunt.file.write(shPath, shContent);

	//TODO chmod the shell-script?

	// semi broken
	var batPath = base + '.bat';
	var batContent = [
		'set PWD=%~dp0',
		'cd ' + path.resolve(cwd),
		'grunt ' + argArr.join(' '),
		'cd "%PWD%"',
		''
	].join('\r\n');

	console.log('argArr: ' + argArr.join(' '));
	grunt.file.write(batPath, batContent);
}

function runGruntfile(grunt, src, tasks, options, callback) {

	//var os = require('os');
	//var assert = require('assert');
	var _ = grunt.util._;

	var mixedStdIO = [];
	var taskList = [];

	var cwd = (_.isUndefined(options.cwd) || _.isNull(options.cwd) ? path.dirname(src) : options.cwd);

	//return value
	var result = {
		error: null,
		res: null,
		code: '',

		fail: false,
		output: '',

		src: src,
		gruntfile: path.basename(src, path.extname(src)),
		cwd: '',

		tasks: taskList,
		options: options,

		// timing
		start: Date.now(),
		end: Date.now(),
		duration: 0,

		// parsed data
		parsed: {}
	};

	var useArgs = options.args;

	// apply defaults
	var argHash = lodash.assign({
		'gruntfile': path.resolve(src)
	}, useArgs);

	if (tasks) {
		if (_.isArray(tasks)) {
			_.forEach(tasks, function (target) {
				taskList.push(target);
			});
		}
		else {
			taskList.push(tasks);
		}
	}
	else {
		// do NOT force default
		// tasks = ['default'];
	}

	// serialise named args
	var argArr = [];
	_.each(argHash, function (value, opt) {
		if (opt.length === 0) {
			argArr.push(value);
		}
		else {
			argArr.push((opt.length === 1 ? '-' : '--') + opt);
			if (value !== true && !(_.isNull(value) && _.isUndefined(value))) {
				argArr.push(value);
			}
		}
	});

	// append task names
	_.each(taskList, function (task) {
		argArr.push(task);
	});

	// for debugging print repeatable cli commands
	if (options.debugCli) {
		grunt.log.writeln([
			'cd ' + path.resolve(cwd),
			'grunt ' + argArr.join(' '),
			'cd ' + process.cwd()
		].join('\n'));

		grunt.log.writeln('');
	}

	// experimental
	if (options.writeShell) {
		writeShell(grunt, options, src, cwd, argArr);
	}

	// spawn cli options
	var param = {
		cmd: 'grunt',
		args: argArr,
		opts: {
			cwd: cwd,
			env: grunt.util._.extend({}, process.env, (options.env || {}))
		}
	};

	// make a child
	var child = grunt.util.spawn(param,
		function (err, res, code) {
			grunt.log.writeln(conf.nub + 'reporting' + ' "' + src + '"');

			// *everything*
			result.error = err;
			result.res = res;
			result.code = code;
			result.output = mixedStdIO.join('');
			result.end = Date.now();
			result.duration = (result.end - result.start);

			// basic check
			if (err || code !== 0) {
				result.fail = true;
			}
			else {
				result.fail = false;
			}

			if (options.parser) {
				if (parsers.hasOwnProperty(options.parser)) {
					var parseOutput = parsers[options.parser];

					result.parsed[options.parser] = parseOutput(result.output);
				}
			}

			// process the result object
			if (options.process) {
				var ret = options.process(result);
				if (_.isUndefined(ret)) {
					// no return value: leaves as-is
				}
				else if (ret === true) {
					// boolean true mean it passes
					result.fail = false;
				}
				else {
					// anythings else mean fail
					result.fail = true;

					var label = 'grunt_cli(' + [tasks].join(' / ') + ')';

					grunt.log.writeln(conf.nub + ('grunt process forced failure').yellow + ' for ' + label);

					if (ret !== false) {
						// only log if not a boolean
						grunt.log.writeln(conf.nub + ret);
					}
				}
			}

			// file the log
			if (options.logFile) {
				var tmp = options.logFile;
				if (grunt.file.isDir(tmp)) {
					tmp = path.join(tmp, 'run-grunt-log.txt');
				}
				grunt.log.writeln(conf.nub + 'saving data' + ' to "' + tmp + '"');
				grunt.file.write(tmp, result.output);
			}

			// bye
			callback(null, result);
		}
	);

	function processBuffer(buffer) {
		var indexOfNewline = buffer.indexOf("\n");

		if (indexOfNewline !== -1) {
			var isUsingCrLf = indexOfNewline > 0 && buffer[indexOfNewline - 1] === "\r";
			
			if (indexOfNewline === (buffer.length - 1)) {
				if (isUsingCrLf) {
					buffer = buffer.slice(0, buffer.length - 2);
				} else {
					buffer = buffer.slice(0, buffer.length - 1);
				}
			}

			var lines;
			if (isUsingCrLf) {
				lines = buffer.split("\r\n");
			} else {
				lines = buffer.split("\n");
			}

			return lines;
		} else {
			return [];
		}
	}

	function logMessage(type, message) {
		// log the log
		if (options.log) {
			var outputMethod = type === 'error' ? grunt.log.error : grunt.log.writeln;

			if (_.isString(options.indentLog) && options.indentLog !== '') {
				outputMethod(options.indentLog + message);
			}
			else {
				outputMethod(message);
			}
		}
	}

	var stdoutBuffer = '';
	var stderrBuffer = '';

	// mix output (this wise?)
	child.stdout.on('data', function (data) {
		mixedStdIO.push(data);

		var partialMessage = data.toString();

		stdoutBuffer += partialMessage;

		var lines = processBuffer(stdoutBuffer);

		if (lines) {
			lines.forEach(function(line) {
				logMessage('info', line);
			});

			stdoutBuffer = '';
		}
	});

	child.stderr.on('data', function (data) {
		mixedStdIO.push(data);

		var partialMessage = data.toString();

		stderrBuffer += partialMessage;

		var lines = processBuffer(stderrBuffer);

		if (lines) {
			lines.forEach(function(line) {
				logMessage('error', line);
			});

			stderrBuffer = '';
		}
	});
}

module.exports = {
	runGruntfile: runGruntfile
};