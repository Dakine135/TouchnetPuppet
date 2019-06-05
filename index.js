const puppeteer = require('puppeteer');
const fs = require("fs");
var moment = require('moment');
const path = require('path');
const util = require('util');
const csvParse = require('csv-parse/lib/sync');
const csvGenerate = require('csv-generate/lib/sync');
const envInputRaw = fs.readFileSync("env.json");
const envInput = JSON.parse(envInputRaw);
var browser;
var closeWhenDone = true;
 
(async () => {
	console.log("Start browser");
	browser = await puppeteer.launch({headless: true, slowMo:1, devtools:false, dumpio:false}); 
	//{headless: false, slowMo: 250}
	
	//login
	let loginToken = await connectAndLogin();
	console.log("logged in with Token", loginToken);

	//get everything since the begning of yesterday
	let dateStart = moment().subtract(1,'day').startOf('day');
	let dateEnd = moment();

	//get raw report as json
	let reportRaw = await getReport(loginToken,dateStart,dateEnd);
	// console.log('ReportRaw:', reportRaw);

	//clean up report and make csv
	let report = await cleanUpReportGetCSV(reportRaw);
	console.log('Report:', report);

	//save report to location
	const writeFileAsync = util.promisify(fs.writeFile);
	await writeFileAsync("./output/GroupXPasses.csv", report, function(err) {
	    if(err) {
	        return console.log(err);
	    }
	    console.log("The file was saved!");
	}); 
 	
 	console.log("finished script");
 	
	if(closeWhenDone) await browser.close();
})().catch(e => {
  console.error(e.stack);
  process.exit(1);
});

async function connectAndLogin(){
	let page = await browser.newPage();
	// await page.setViewport({width: 1920, height: 1080});
	await page.goto(envInput.urlLogin);
	console.log("Navigate to and login",envInput.urlLogin);
	// await page.waitForNavigation();

  	// Login
	await page.type('#username', envInput.login);
	await page.type('#password', envInput.pass);
	await Promise.all([
	  page.click('input[value="LOGIN"]'),
	  page.waitForNavigation()
	]);
	
	await page.waitForSelector("input");
	console.log('page loaded');
	let token = await page.evaluate(() => {
		let tokenDoc = document.querySelector('input[name="tapp-stoken"]');
		let token = tokenDoc.value;
		// console.log("token in eval", token);
		return token;
	});
	
	if(closeWhenDone) page.close();
	// console.log("Logged in with token", token);
	return token;
}

function dateToUrlEncoding(date){
	// console.log("date in func:",date);
	let space = '%20';
	let slash = '%2F';
	let colon = '%3A';
	// let tempDate = date.monthIndex+slash+date.day+slash+date.year+
	// 			   space+date.hours+colon+date.minutes;
	let tempDate = date.format('M['+slash+']DD['+slash+']YY['+space+']hh['+colon+']mm['+space+']A');
	return tempDate;
}

async function getReport(token,startDate,endDate){
	let urlDateStart = dateToUrlEncoding(startDate);
	// console.log('urlDateStart',urlDateStart);
	//need to load the main sales page for the full year back to prefetch all possible semestors,
	//or the detailed product page will fail
	let urlDateStartLastYear = dateToUrlEncoding(startDate.subtract(1,'year'));
	// console.log('urlDateStartLastYear',urlDateStartLastYear);
	let urlDateEnd = dateToUrlEncoding(endDate);
	// console.log('urlDateEnd',urlDateEnd);
	let url1 = "https://secure.touchnet.net/C21544_tmsadmin/tapp?"+
	"Navigate=finance/store_sales.jsp"+
	"&LOAD_STORE_SALES=ActionKey"+
	"&TMS_MERCHANT_ID=0&STORE_ID=52"+
	"&START_DATE="+urlDateStartLastYear+
	"&END_DATE="+urlDateEnd+
	"&REPORT=PRODUCT"+
	"&OnError=app_error.jsp"+
	"&LOADING_MESSAGE=true"+
	"&tapp-stoken="+token;
	let url2 = "https://secure.touchnet.net/C21544_tmsadmin/tapp?"+
	"tapp-stoken="+token+
	// "&Navigate=finance/export_product_detail_report_to_csv.jsp"+
	"&Navigate=finance/product_detail.jsp"+
	"&OnError=finance/store_sales.jsp"+
	"&LOAD_PRODUCT_DETAIL=ActionKey"+
	"&REPORT_TYPE=0"+
	"&PRODUCT_ID=0,1,2"+ //pulls from all possible semestors
	"&STORE_ID=52"+
	"&TMS_MERCHANT_ID=0"+
	"&START_DATE="+urlDateStart+
	"&END_DATE="+urlDateEnd;



	// console.log("URL1:",url1);
	// console.log("URL2:",url2);
	//this will load the page with all semstors, allowing the details search
	let page1 = await browser.newPage();
	await page1.goto(url1);

	//does the search on the details page
	let page2 = await browser.newPage();
	await page2.goto(url2).catch(()=>{console.log('ignore error')});

	//clicks download and grabs file path
	const filePath = await download(page2, ()=>{
		page2.click('input[value="Export to CSV"]');
	});
	// console.log('filePath:', filePath);
	const { size } = await util.promisify(fs.stat)(filePath);
    console.log('FilePath: ', filePath, `${size}B`);

    //reads file that was downloaded and parses to json from csv
    let output = await readAndParseFile(filePath);
    // console.log("output:",output);

    //clean up downloaded file
    const deleteFileAsync = util.promisify(fs.unlink);
    const deleteFolderAsync = util.promisify(fs.rmdir);
    await deleteFileAsync(filePath);
    console.log(filePath, 'was deleted');
    let folderPath =  path.dirname(filePath);

    let fileName = "Not Null";
    while (fileName) {
	    await new Promise(resolve => setTimeout(resolve, 100)); //, reject => console.log('reject')
	    [fileName] = await util.promisify(fs.readdir)(folderPath);
	    console.log("Waiting for File to be deleted");
  	}
  	//cant delete folder until file is deleted
    await deleteFolderAsync(folderPath);
    console.log(folderPath, 'was deleted');
	
    
	if(closeWhenDone) {await page1.close(); await page2.close()}
	return output;
}

// set up, invoke the function, wait for the download to complete
async function download(page, f) {
  const downloadPath = path.resolve(
    process.cwd(),
    `download-${Math.random()
      .toString(36)
      .substr(2, 8)}`,
  );
  await util.promisify(fs.mkdir)(downloadPath);
  // console.error('Download directory:', downloadPath);

  await page._client.send('Page.setDownloadBehavior', {
    behavior: 'allow',
    downloadPath: downloadPath,
  });

  // console.log("BEFORE download triggered");
  // await page.goto(url).catch(()=>{console.log('ignore error')});
  await f();
  // console.log("AFTER download triggered");

  console.error('Downloading...');
  let fileName;
  while (!fileName || fileName.endsWith('.crdownload')) {
    await new Promise(resolve => setTimeout(resolve, 100)); //, reject => console.log('reject')
    [fileName] = await util.promisify(fs.readdir)(downloadPath);
  }

  const filePath = path.resolve(downloadPath, fileName);
  // console.error('Downloaded file:', filePath);
  return filePath;
}

async function readAndParseFile(filePath){
	const readFileAsync = util.promisify(fs.readFile);
	try{
		let data = await readFileAsync(filePath, {encoding: 'utf8'});
		// console.log("data:",data);
		let output = csvParse(data, {
			  columns: true,
			  skip_empty_lines: true
		});
		// console.log("output IN:",output);
		return output;
	} catch(err){

	}
}

/*
File Name: GroupXPasses.csv                                         
Directory: Campus Recreation Sharedrive pending permissions for UC4USR
File Format: .csv
Date Fulfilled	Email Address	First Name	Last Name	VIP Number
04/14/2019 08:46:05 PM EST	cdmartin@email.sc.edu	Chylee	Martin	281719
04/14/2019 01:46:24 PM EST	cah21@email.sc.edu	Catherine	Hood	482081

*/
function cleanUpReportGetCSV(reportRaw){
	let output = "Date Fulfilled,Email Address,First Name,Last Name,VIP Number\n";
	reportRaw.forEach((item)=>{
		let row = `${item['Date Fulfilled']},${item['Email Address']},${item['First Name']},${item['Last Name']},${item['VIP Number']}\n`;
		output = output + row;
	});
	return output;
}