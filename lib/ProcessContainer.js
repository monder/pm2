// ProcessContainer.js
// Child wrapper. Redirect output to files, assign pid & co.
// by Strzelewicz Alexandre

var fs     = require('fs');
var p      = require('path');
var cst    = require('../constants');
var worker = require('cluster').worker;

require('coffee-script/register');

/**
 * Main entrance to wrap the desired code
 */

(function ProcessContainer() {
  var fs          = require('fs');
  var worker      = require('cluster').worker;
  var util        = require('util');

  var outFile     = process.env.pm_out_log_path;
  var errFile     = process.env.pm_err_log_path;
  var pmId        = process.env.pm_id;
  var pidFile     = [process.env.pm_pid_path, pmId, '.pid'].join('');
  var script      = process.env.pm_exec_path;
  var cronRestart = process.env.cron_restart;

  if (cst.MODIFY_REQUIRE)
    require.main.filename = process.env.pm_exec_path;

  fs.writeFileSync(pidFile, process.pid);

  // Add args to process if args specified on start
  if (process.env.args != null)
    process.argv = process.argv.concat(eval(process.env.args));

  // Rename process
  if (process.env.name != null)
    process.title = 'pm2: ' + process.env.name;

  if (process.env.extra_env != null) {
    var extra_env = process.env.extra_env.split(',');
    extra_env.forEach(function(envFile, i) {
      var data = fs.readFileSync(envFile);
      var env = JSON.parse(data);
      util._extend(process.env, env);
    });
  }
  exec(script, outFile, errFile);

  if (cronRestart)
    cronize(cronRestart);
})();

//
// Cron pattern like to force app to restart
//
function cronize(cron_pattern) {
  var cronJob = require('cron').CronJob;
  var job = new cronJob({
    cronTime: cron_pattern,
    onTick: function() {
      process.exit(0);
    },
    start: false
  });
  job.start();
}

function exec(script, outFile, errFile) {
  // Change dir to fix process.cwd
  process.chdir(process.env.PWD || p.dirname(script));

  var stderr, stdout;

  process.on('message', function (msg) {
    if (msg.type === 'log:reload') {
      stdout.end();
      stderr.end();
      startLogging(function () {
        console.log('Reloading log...');
      });
    }
  });

  function startLogging(callback) {
    stdout = fs.createWriteStream(outFile, { flags : 'a' });

    stdout.on('open', function() {
      stderr = fs.createWriteStream(errFile, { flags : 'a' });
      stderr.on('open', function() {

        process.stderr.write = (function(write) {
                                  return function(string, encoding, fd) {
                                    stderr.write(string);
                                    process.send({
                                      type : 'log:err',
                                      data : string
                                    });
                                  };
                                }
                               )(process.stderr.write);

        process.stdout.write = (function(write) {
                                  return function(string, encoding, fd) {
                                    stdout.write(string);
                                    process.send({
                                      type : 'log:out',
                                      data : string
                                    });
                                  };
                                })(process.stdout.write);
        callback();
      });
    });
  }

  startLogging(function () {
    process.on('uncaughtException', function uncaughtListener(err) {
      try {
        stderr.write(err.stack);
      } catch(e) {
        stderr.write(err.toString());
      }

      // Notify master that an uncaughtException has been catched
      process.send({
        type : 'uncaughtException',
        stack : err.stack,
        err  : {
            type: err.type,
            stack: err.stack,
            arguments: err.arguments,
            message: err.message
          }
      });

      if (!process.listeners('uncaughtException').filter(function (listener) {
          return listener !== uncaughtListener;
      }).length) {
        setTimeout(function() {
          process.exit(cst.CODE_UNCAUGHTEXCEPTION);
        }, 100);
      }
    });

    // Get the script & exec
    require(script);
  });

};
