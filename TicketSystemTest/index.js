const puppeteer = require('puppeteer');
const fs = require("fs");
const envInputRaw = fs.readFileSync("env.json");
const envInput = JSON.parse(envInputRaw);
var browser;
 
(async () => {
	console.log("Start browser");
	browser = await puppeteer.launch({headless: false}); //{headless: false, slowMo: 250}
	
	await connectAndLogin();

	let allActivity = await getActivites();

 	allActivity.forEach(async(item)=>{
 		if(item.action == 'added'){
	 		item.parts.forEach(async (part)=>{
	 			if(part.type == 'tickets'){
	 				let allNotesFromTicket = await getNotesFromTicket(part.ticketNumber);
	 				allNotesFromTicket.forEach((note)=>{
	 					// console.log(item.dateTime, '<==>', note.dateTime);
	 					if(item.dateTime == note.dateTime){
	 						part.note = note;
	 					}
	 				});
	 				// console.log(part.notes);
	 			}
	 			console.log("----Start----");
	 			console.log(item);
	 			item.parts.forEach((part)=>{
	 				if(part.note) console.log(part.note);
	 			});
	 			console.log("----END----");
	 		}); //each part
 		} //added
 	}); //each activity item
 	
 	console.log("finished script");
 	
	// await browser.close();
})();

async function connectAndLogin(){
	let page = await browser.newPage();
	// await page.setViewport({width: 1920, height: 1080});
	await page.goto('https://support.sa.sc.edu');
	// await page.screenshot({path: 'example.png'});
	console.log("Navigate to Support SATS");

  	// Login
	await page.type('#user_session_login', envInput.login);
	await page.type('#user_session_password', envInput.pass);
	await page.click('input[value="Login"]');
	page.close();
	console.log("Logged in");
	// await page.waitForNavigation();
}

async function getActivites(){
	let page = await browser.newPage();
	//go to activities page and get list
	await page.goto('https://support.sa.sc.edu/activities');
	// await page.waitForNavigation();
	console.log("Go to activities page");
	return await page.evaluate(() => {
        let activities = [];
        //get all direct children of element with class "container main"
        let everythingInMain = document.querySelectorAll('.container.main > *');
        // console.log(everythingInMain);
        let date = "N/A";
        everythingInMain.forEach((item)=>{
        	// console.log(item.tagName);
        	if(item.tagName == 'H3'){
        		// console.log("H3 tag:",item.innerText);
        		date = item.innerText;
        	} else if(item.classList.contains('activity')){
        		let activityJson = {};
	            // console.log(item);
	            try {
	            	let iconName = item.querySelector('i').className;
	            	let iconType = iconName.split(' ')[1].split('-')[1];
	            	// console.log('iconType: ', iconType);
	            	activityJson.iconType = iconType;
	            	activityJson.text = item.innerText;
	            	activityJson.action = activityJson.text.split(' ')[3];
	            	activityJson.dateTime = date +' '+ activityJson.text.split(' at ')[1];
	            	let partsElms = item.querySelectorAll('a');
	            	activityJson.parts = [];
	            	partsElms.forEach((part)=>{
	            		let partObj = {};
	            		partObj.text = part.innerText;
	            		partObj.link = part.href;
	            		partObj.type = part.href.split('/')[4];
	            		if(partObj.type == 'tickets') partObj.ticketNumber = part.href.split('/')[5];
	            		activityJson.parts.push(partObj);

	            	});
	            }
	            catch (exception){

	            }
	            activities.push(activityJson);
        	}
        });
        return activities;
    });
}

//open page referenced, get ticket comments
async function getNotesFromTicket(ticketNumber){
	console.log("open new tab for ticket: ", ticketNumber);
	let tab = await browser.newPage();
	await tab.goto('https://support.sa.sc.edu/admin/tickets/'+ticketNumber+'/edit');
	let ticketNotes = await tab.evaluate(() => {
		let notes = [];
		let notesDiv = document.querySelector('#notes');
		console.log(notesDiv);
		let eachNoteDiv = notesDiv.querySelectorAll('div .media-body');
		// console.log(eachNoteDivs);
		eachNoteDiv.forEach((noteDiv)=>{
			let tempNote = {};
			console.log(noteDiv);
			tempNote.text = noteDiv.querySelector('p').innerText;
			let headingText = noteDiv.querySelector('.media-heading').innerText.split('\n')[0];
			headingTextSplit = headingText.split(' ');
			console.log("headingTextSplit: ",headingTextSplit);
			if(headingTextSplit[1] == 'PRIVATE'){
				tempNote.private = true;
				tempNote.user = headingTextSplit[2] +' '+ headingTextSplit[3];
			}
			else{
				tempNote.private = false;
				tempNote.user = headingText;
			}
			
			tempNote.dateTime = noteDiv.querySelector('.pull-right').innerText;
			notes.push(tempNote);
		});
		return notes;
	});
	tab.close();
	return ticketNotes;
}