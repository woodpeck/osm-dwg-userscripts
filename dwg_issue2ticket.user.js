// ==UserScript==
// @name          dwg_issue2ticket
// @namespace     https://htmlblog.net
// @description   Automatically creates OTRS tickets from OSM webpage issues
// @include       https://www.openstreetmap.org/issues/*
// @grant         GM.setValue
// @grant         GM.getValue
// ==/UserScript==

let queue = "Data Working Group";
let newlink;

try {

  // find the existing "ignore" link on the page and add a nice matching "create OTRS ticket" link
  let ignore_xpath = `//a[@href='${window.location.href}/ignore']`;
  let anchor = document.evaluate(ignore_xpath, document, null, XPathResult.FIRST_ORDERED_NODE_TYPE, null).singleNodeValue;
  let pipe = anchor.previousSibling.cloneNode();
  newlink = document.createElement("A");

  newlink.innerHTML="Create OTRS ticket";
  newlink.href="#";
  anchor.parentNode.insertBefore(newlink, anchor.nextSibling);
  anchor.parentNode.insertBefore(pipe, newlink);
  newlink.addEventListener("click", createOtrsTicket);

} 
catch(e) 
{
  
  // if the "nice" link didn't work for any reason - maybe changed site layout - then at least do it ugly
  console.log("Cannot find anchor - likely closed issue, or else layout change");
}
  
// workhorse function. invoked when link is clicked
async function createOtrsTicket()
{
  
  // pick content div
  let content = document.getElementById("content");
 
  // determine the issue number for use in ticket title
  let h2_array = content.getElementsByTagName("h2");
  let h2 = h2_array[0];
  let match = /Open (Issue #\d+)/.exec(h2.innerHTML);
  if (!match) {
     alert(`Cannot parse h2 of '${title}'`);
     throw("");
  } 
  
  // give user opportunity to amend title
  let title = match[1];
  title = prompt("ticket title:", title);
    
  // determine username of complainant
  match = /Reported as \S+ by <a[^>]+>([^<]+)</.exec(content.innerHTML);
  if (!match) {
     alert(`Cannot extract complainant username`);
     throw("");
  }
  let complainant = match[1];
  
  // now clean up the HTML of the issue, by 
  // 1. dropping unwanted links
  // 2. dropping the input box at the end
  // 3. fixing a href/img src URLs so they still work in OTRS
  
  let clone = content.cloneNode(true);
  let comment_div = document.evaluate("//div[@class='comment']", clone, null, XPathResult.FIRST_ORDERED_NODE_TYPE, null).singleNodeValue;
  comment_div.parentNode.removeChild(comment_div);

  let anchors = clone.getElementsByTagName("a");
  for (let anchor of anchors) 
  {
    if (anchor.href.startsWith("https://www.openstreetmap.org/issues")) {
       anchor.href= "";
       anchor.innerHTML = "";
    } else if (anchor.href.startsWith("/")) {
       anchor.href = "https://www.openstreetmap.org " + anchor.href;
    } else {
       anchor.href = anchor.href;
    }                
  }
  
  let images = clone.getElementsByTagName("img");
  for (let image of images) {
    if (image.src.startsWith("/")) {
       image.src = "https://www.openstreetmap.org " + image.src;
    } else {
       image.src = image.src;
    }                
  }
  
  // create JSON message for OTRS
  let ticket = { 
    "Ticket" : {
      "Queue" : queue,
      "State" : "open",
      "Priority" : "3 normal",
      "CustomerUser" : `${encodeURI(complainant)}@thisdoesnotwork.users.openstreetmap.org`,
      "Title" : title
    },
     "Article" : {
       "CommunicationChannel" : "Phone",
       "ContentType" : "text/html; charset=utf8",
       "Subject" : title,
       "Body" : clone.innerHTML
     }
  };

  // try to retrieve username and password for OTRS from the GreaseMonkey variable store.
  // if not present, ask user & save to store
  let username = await GM.getValue("otrs_username");
  if (!username || username === "") 
  {
    username = prompt("OTRS User Name:");
    GM.setValue("otrs_username", username);
  }
  let password = await GM.getValue("otrs_password");
  if (!password || password === "") 
  {
    password = prompt("OTRS Password:");
    GM.setValue("otrs_password", password);
  }
  
  // add username and password to JSON payload.
  ticket.UserLogin = username;
  ticket.Password = password;
  
  // prepare and execute POST request
  let settings = {
    "method" : "POST",
    "body" : JSON.stringify(ticket)
  };
  let response = await fetch(`https://otrs.openstreetmap.org/otrs/nph-genericinterface.pl/Webservice/OsmWebsiteIntegration/createTicket`, settings);
  let json = await response.json();
  
  // check for error (note, a low-level error like host not responding would cause an exception above
  // and break things)
  if (json.Error) {
    if (json.Error.ErrorCode == "TicketCreate.AuthFail") {
      alert("OTRS Authentication failed. Try again.");
      // we have to delete the stored user name and password so that the script asks again next time.
      // GM.deleteValue did not work for me.
      GM.setValue("otrs_username", "");
      GM.setValue("otrs_password", "");
      return;
    } else {
      alert("OTRS error: " + json.Error.ErrorMessage);
      return;
    }
  }
  
  // on success, plant message into textarea that user can then submit.
  // we *could* close the ticket automatically but let's not do that at this point in time.
  let textarea = document.getElementById("issue_comment_body");
  textarea.value = `OTRS ticket created: #${json.TicketNumber}\nhttps://otrs.openstreetmap.org/otrs/index.pl?Action=AgentTicketZoom;TicketID=${json.TicketID}`;

  // disable the "create ticket" link
  if (newlink) 
  {
    newlink.innerHTML = "<s>Create OTRS ticket</s>";
    newlink.removeEventListener("click", createOtrsTicket);
    newlink.removeAttribute("href");
    newlink.style.enabled = false;
  }
}
