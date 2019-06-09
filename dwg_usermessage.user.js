// ==UserScript==
// @name     dwg_usermesssage
// @version  1
// @grant    none
// @match    https://otrs.openstreetmap.org/otrs/index.pl?Action=AgentTicketNote;TicketID=*
// @match    https://otrs.openstreetmap.org/otrs/index.pl?Action=AgentTicketClose;TicketID=*
// @match    https://www.openstreetmap.org/message/new/*
// @match    https://www.openstreetmap.org/messages/inbox
// @match    https://www.openstreetmap.org/login?referer=%2Fmessages%2Finbox
// @require  https://unpkg.com/turndown/dist/turndown.js
// ==/UserScript==

// written by Frederik Ramm <frederik@remote.org>, Public Domain
// 
// This script is run twice - once in OTRS, where it creates an iframe
// calling the OSM web site, and a second time in that OSM web site. 
// This could equally well be engineered as two different scripts but it
// is easier to maintain as one.
//
// In order to control the OSM web site in an iframe, we need to override
// both the "content security policy" and the "x-frame-options" headers,
// which the OSM web site uses to tell the browser that it does not want 
// to be run in a frame. There are different ways to achieve this. For 
// Firefox, one option is:
// 1. go to "about:config" and set "security.csp.enable" to "false" -
//    note that this disables CSP for all web sites
// 2. install the "Ignore X-Frame-Options Header" add-on and make set
//    the whitelist to "https://www.openstreetmap.org/*"
// There migtht be other addons that let you filter out arbitrary headers
// for specific websites only; another option is using a local proxy that
// removes these headers.
// ----------------------------------------------------------------------
                                                 
let iframe;
let statusmsg;
let messagebutton;

if (window.location.href.startsWith("https://otrs.openstreetmap.org")) {
  otrs_aspect();
} else {
  osm_aspect();
}

// This is the part that runs in OTRS.
// Its main job is to send messages to the OSM iframe when
// (a) the "subject" line is filled out, potentially containing a recipient name
// (b) the "send message" button is clicked.

function otrs_aspect()
{
  // parse OTRS page
  let form = document.getElementById("Compose");
  if (!form) {
    console.log("OTRS page does not look right");
    throw("");
  }
  
  // create OSM iframe, point it to the "inbox" page where it will receive
  // a redirect to login if not logged in.
  iframe = document.createElement("iframe");
  iframe.setAttribute("src", "https://www.openstreetmap.org/messages/inbox");
  iframe.style.width = "100%";
  iframe.style.height = "400px";
  iframe.style.display = "none";

  // add frame to page
  form.parentNode.appendChild(iframe);

  // set us up for receiving messages from the iframe
  window.addEventListener("message", receiveMessageFromIframe, false);
  
  // create a new button and add it to the existing button bar
  let submit = document.getElementById("submitRichText");
  messagebutton = document.createElement("button");
  messagebutton.innerHTML = "<span>create OSM message</span>";
  messagebutton.disabled = true;
  messagebutton.addEventListener("click", send_osm_message);
  messagebutton.classList.add("CallForAction")
  submit.parentNode.insertBefore(messagebutton, submit);
  submit.parentNode.insertBefore(document.createTextNode(" / "), submit);

  // identify the "subject" line and add an event listener
  let subject = document.getElementById("Subject");
  subject.addEventListener("blur", eval_subject);
  
  // add a "status bar" below the subject line, for feedback from the 
  // OSM iframe
  statusbar = document.createElement("div");
  statusmsg = document.createElement("span");
  statusmsg.innerHTML="OSM status not available - perhaps a CSP or X-Frame-Options issue?";
  iframebox = document.createElement("input");
  iframebox.type = "checkbox";
  iframeboxlabel = document.createElement("label");
  iframeboxlabel.appendChild(document.createTextNode("show OSM iframe"));
  iframeboxlabel.appendChild(iframebox);
  iframebox.checked = false;
  iframebox.addEventListener("change", function(e) { 
    iframe.style.display = e.target.checked ? "inline" : "none";  
  });
  statusbar.appendChild(statusmsg);
  statusbar.appendChild(document.createTextNode(" | "));
  statusbar.appendChild(iframeboxlabel);
  subject.parentNode.appendChild(statusbar);
}

// if the subject line is filled out with something matching "to ...",
// assume what comes after "to" is an user name and trigger iframe to 
// open a "send message to ..." user. Note this will generate an error
// in case the user does not exist, which will be reported back properly.
function eval_subject(e)
{
  let text = e.target.value;
  let matches = text.match(/\sto\s(.*)/);
  if (matches) {
    iframe.src = `https://www.openstreetmap.org/message/new/${matches[1]}`;
  }
}

// this is called when the "send OSM message" button is clicked. It utilizes
// a 3rd party library called "turndown" to convert OSRM's rich text HTML to
// a "markdown" message for OSM. If the message body's first line is something
// like "Subject: XXX", then XXX becomes the subject for the OSM message.
function send_osm_message(e)
{
  e.preventDefault();
  let subject = document.getElementById("Subject");
  let rt = document.getElementById("RichText");
  let win = iframe.contentWindow;
  let turndownService = new TurndownService();
  let markdown = turndownService.turndown(rt.value);
  let message = { "body" : markdown, "subject" : "Message from DWG" };
  let matches = markdown.match(/^\s*subject:\s*([^\n\r]*?)(\r?\n)+([\s\S]*)/i);
  if (matches) {
    message = { "body" : matches[3], "subject" : matches[1] }
  }
  win.postMessage(JSON.stringify(message), "*");
}

// This is called when the iframe sends a message. It updates the status message,
// and enables the "send message" button only if the iframe reports ready.
function receiveMessageFromIframe(event)
{
  let json=JSON.parse(event.data);
  statusmsg.innerHTML = "OSM says: " + json.text;
  messagebutton.disabled = !json.ok;
}

// ------------------------------------------------------------------------------
// this is the part that runs on the OSM website

function osm_aspect()
{
  if (window.location === window.parent.location) {
    // not in an iframe. quit without spamming the console
    return;
  }

  // this code tries to detect the various states the OSM web site can be in:
  // * we are not logged in
  // * we are logged in and have not yet requested composing a message
  // * we have requested composing a message to an invalid user
  // * we have requested composing a message to a valid user
  // * we have successfully sent the message
  // It generates appropriate messages back to the container (OTRS) where
  // the status is displayed in the status bar under the subject line. Only
  // if we are in the "have requested composing messag to valid user" status
  // do we send "ok=true" which enables the "send message" button on OTRS.
  
  // pessimistic default
  let message = { "ok" : false, "text" : "The OSM page cannot be parsed properly." };
  if (window.location.href == "https://www.openstreetmap.org/login?referer=%2Fmessages%2Finbox") {
      message = { "ok" : false, "text" : "Please log in to OSM in another tab, then reload this page" };
  } else if (window.location.href == "https://www.openstreetmap.org/messages/inbox") {
    let flash = document.evaluate("//div[@class='flash notice']//div[@class='message']", document, null, XPathResult.FIRST_ORDERED_NODE_TYPE, null).singleNodeValue;
    let userbutton = document.evaluate("//span[@class='user-button']//span[@class='username']", document, null, XPathResult.FIRST_ORDERED_NODE_TYPE, null).singleNodeValue;
    if (flash) {
      message = { "ok" : false, "text" : flash.innerHTML };
    } else if (userbutton) {
      message = { "ok" : false, "text" : "ready to send, logged in as " + userbutton.innerHTML }
    }
  } else {
    let h = document.evaluate("//div[@id='content']//*[(self::h1 or self::h2)]", document, null, XPathResult.FIRST_ORDERED_NODE_TYPE, null).singleNodeValue;
    message = { "ok" : (h.nodeName == "H2"), "text" : h.innerText };
  }
  parent.postMessage(JSON.stringify(message), "*");
  if (message.ok) window.addEventListener("message", receiveMessageFromContainer, false);
}

// the only kind of message we receive is a "send OSM message" command;
// parse and send the message.
function receiveMessageFromContainer(event) 
{
    let json = JSON.parse(event.data);
    document.getElementById("message_title").value = json.subject;
    document.getElementById("message_body").value = json.body;
    document.getElementById("new_message").submit();
}
