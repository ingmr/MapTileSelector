var express = require("express");
var exec = require('child_process').exec;
var chain_gang = require('chain-gang');
var chain = chain_gang.create({workers: 1});
var http = require('http');
var fs = require('fs');

initWorkerChain();


var faviconMiddleware = express.favicon('public/favicon.png');
var loggerMiddleware = express.logger('dev');
var bodyParserMiddleware = express.bodyParser();
var queryMiddleware = express.query();
var staticMiddleware = express.static(__dirname + '/public');
var cookieParserMiddleware = express.cookieParser('235c517041a5354facc7384e62ae29403ce341ca');
var sessionMiddleware = express.session({
	/*store : new RedisStore({
		ttl : 60 * 60,
		prefix : 'mmaf-session'
	}),*/
	key : 'sid'
});

var app = express();
app.use(faviconMiddleware);
app.use(loggerMiddleware);
app.use(bodyParserMiddleware);
app.use(staticMiddleware);
app.use(cookieParserMiddleware);
app.use(sessionMiddleware);


app.post("/api/startDownload", startDownload);
app.get("/api/status", status);

app.listen(80);
console.log("Listening on port 80");

var data, numEmptyTiles, numTilesToDownload, numColsToCreate, finished;

function startDownload(req, res) {
	data = JSON.parse(req.body.data);

	console.log("Size: " + data.data.length + ", " + data.data[0].length);

	var numTiles = data.data.length * data.data[0].length;

	numTilesToDownload = {"all": countNumTilesToDownload(), "finished": 0};
	numEmptyTiles = {"all": numTiles - numTilesToDownload.all, "finished": 0};
	numColsToCreate = {"all": data.data.length, "finished": 0};

	finished = false;

	status(req, res);

	var file = fs.createWriteStream("data/meta.json");

	file.end(req.body.data);

	createDownloadTasks();

	createCombineTasks()
}

function status(req, res){

	var stat = updateStatus();

	res.writeHead(200, {
		"Content-Type": "application/json"
	});
	res.end(JSON.stringify(stat));
}

function countNumTilesToDownload(){
	var numTiles = 0;
	for(var x = 0; x < data.data.length; x++){
		for(var y = 0; y < data.data[0].length; y++){
			if(data.data[x][y]){
				numTiles += 1;
			}
		}
	}

	return numTiles;
}

function updateStatus(){

	var percentDownload = numTilesToDownload.finished / numTilesToDownload.all;
	var percentEmpty = numEmptyTiles.finished / numEmptyTiles.all;
	var percentCols = numColsToCreate.finished / numColsToCreate.all;

	var percent = percentDownload * 0.5 + percentEmpty * 0.3 + percentCols * 0.1;

	var task;
	if(numTilesToDownload.finished === numTilesToDownload.all){
		task = "Combinig Images";
	}else{
		task = "Downloading Images";
	}
	
	if(finished){
		percent = 1;
	}

	return {
		"numTilesToDownload": numTilesToDownload.all - numTilesToDownload.finished,
		"percent": percent * 100,
		"task": task
	};
}

function createDownloadTasks()
{
	for(var x = 0; x < data.xSize; x++){
		for(var y = 0; y < data.ySize; y++){
			addDownloadTask(x, y)
		}
	}

}

function addDownloadTask(x, y){
	var fileName = "data\\tile_" + x + "_" + y + ".jpg";

	var task = function(worker){

		if(data.data[x][y]){
			//download
			downloadTile(x + data.xOffset, y + data.yOffset, data.lod, fileName, function(){
				numTilesToDownload.finished += 1;
				worker.finish();
			});
		}else{
			//create emty texture
			exec("convert -size 255x255 xc:white " + fileName, function(){
				numEmptyTiles.finished += 1;
				worker.finish();
			});
		}
	};
	chain.add(task, fileName);
}

function createCombineTasks()
{
	for(var x = 0; x < data.xSize; x++){
		addCombineTask(x, data.ySize);
	}
	addFinalCombineTask(data.xSize);
}

function addCombineTask(x, ySize){
	var fileName = "data\\col_" + x + ".png";

	var task = function(worker){
		exec("montage data\\tile_" + x + "_{0.." + (ySize - 1)  + "}.jpg -tile 1x" + ySize + " -geometry 255x255+0+0 " + fileName, function(){
			numColsToCreate.finished += 1;
			worker.finish();
		});
	};
	chain.add(task, fileName);
}

function addFinalCombineTask(xSize){

	var task = function(worker){

		exec("montage data\\col_{0.." + (xSize - 1)  + "}.png -tile " + xSize + "x1 -geometry 255x" + 255 * xSize + "+0+0 data\\out.png", function(){
			finished = true;
			worker.finish();
		});
	};
	chain.add(task, "FinalCombineTask");
}

function initWorkerChain(){
	chain.on('add', function(name) {
		console.log((new Date().toUTCString()), name, "has been queued.")
	});

	chain.on('starting', function(name) {
		console.log((new Date().toUTCString()), name, "has been started running.")
	});

	chain.on('finished', function(err, name) {
		if(err){
			console.error((new Date().toUTCString()), name, "has finished with error:", err);
		}else{
			console.log((new Date().toUTCString()), name, "has finished.")
		}
	});

	chain.on('timeout', function(job) {
		console.error((new Date().toUTCString()), job.name, 'timed out')
	});
}

function downloadTile(x, y, z, fileName, callback){
	var file = fs.createWriteStream(fileName);

	var options = {
		host: "khm1.googleapis.com",
		port: 80,
		path: "/kh?v=125&x=" + x + "&y=" + y + "&z=" + z + "",
		headers: {"User-Agent": "Mozilla/5.0 (Windows; U; Windows NT 5.1; en-US; rv:1.8.1.1) Gecko/20061204 Firefox/2.0.0.1"}
	};

	http.get(options, function(res) {
    	res.on("data", function(data) {
            file.write(data);
        }).on("end", function() {
            file.end();
            callback();
        }).on("error", function(e){
        	console.log(e);
        	throw e;
        });
    });
}