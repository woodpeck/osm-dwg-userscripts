// ==UserScript==
// @name     dwg_usermesssage
// @version  1
// @grant    none
// @match    https://otrs.openstreetmap.org/otrs/index.pl?Action=AgentTicketNote;TicketID=*
// @match    https://www.openstreetmap.org/message/new/*
// @match    https://www.openstreetmap.org/messages/inbox
// @require  https://unpkg.com/turndown/dist/turndown.js
// ==/UserScript==

// This script is run twice - once in OTRS, where it creates an iframe
// calling the OSM web site, in which is then run again.

let iframe;
let statusmsg;
let copybutton;

if (window.location.href.startsWith("https://otrs.openstreetmap.org")) {
  otrs_aspect();
} else {
  osm_aspect();
}

// this is the part that runs in OTRS

function otrs_aspect()
{
  let form = document.getElementById("Compose");
  if (!form) {
    console.log("OTRS page does not look right");
    throw("");
  }
  iframe = document.createElement("iframe");
  iframe.setAttribute("src", "https://www.openstreetmap.org/message/new/woodpeck");
  iframe.style.width = "100px";
  iframe.style.height = "100px";
  //iframe.addEventListener("load", iframe_loaded);
  form.parentNode.appendChild(iframe);
  let submit = document.getElementById("submitRichText");
  copybutton = document.createElement("button");
  copybutton.innerHTML = "<span>create OSM message</span>";
  copybutton.disabled = true;
  submit.parentNode.insertBefore(copybutton, submit);
  let span = document.createElement("span");
  span.innerHTML = "&nbsp;/&nbsp;"
  submit.parentNode.insertBefore(span, submit);
  copybutton.addEventListener("click", copy_text);
  copybutton.classList.add("CallForAction")
  let subject = document.getElementById("Subject");
  subject.addEventListener("blur", eval_subject);
  statusmsg = document.createElement("div");
  statusmsg.innerHTML="OSM status not available";
  subject.parentNode.appendChild(statusmsg);
  
  window.addEventListener("message", receiveMessageFromIframe, false);
}

function eval_subject(e)
{
  let text = e.target.value;
  let matches = text.match(/\sto\s(.*)/);
  if (matches) {
    iframe.src = `https://www.openstreetmap.org/message/new/${matches[1]}`;
  }
}

function copy_text(e)
{
  e.preventDefault();
  let subject = document.getElementById("Subject");
  let rt = document.getElementById("RichText");
  let win = iframe.contentWindow;
  let turndownService = new TurndownService()
  let markdown = turndownService.turndown(rt.value)
  let message = { "body" : markdown, "subject" : "" };
  let matches = markdown.match(/^\s*subject:\s*([^\n\r]*?)(\r?\n)+([\s\S]*)/i);
  if (matches) {
    message = { "body" : matches[3], "subject" : matches[1] }
  }
  win.postMessage(JSON.stringify(message), "*");
}

function receiveMessageFromIframe(event)
{
  let json=JSON.parse(event.data);
  statusmsg.innerHTML = "OSM says: " + json.text;
  copybutton.disabled = !json.ok;
}
// this is the part that runs on the OSM website

function osm_aspect()
{
  if (window.location === window.parent.location) {
    // not in an iframe. quit without spamming the console
    return;
  }

  let message = { "ok" : false, "text" : "The OSM page cannot be parsed properly." };
  let flash = document.evaluate("//div[@class='flash notice']//div[@class='message']", document, null, XPathResult.FIRST_ORDERED_NODE_TYPE, null).singleNodeValue;
  if (flash) {
    message = { "ok" : false, "text" : flash.innerHTML };
  } else {
     let h = document.evaluate("//div[@id='content']//*[(self::h1 or self::h2)]", document, null, XPathResult.FIRST_ORDERED_NODE_TYPE, null).singleNodeValue;
     if (h) {
       message = { "ok" : (h.nodeName == "H2"), "text" : h.innerHTML };
     }
  }
  parent.postMessage(JSON.stringify(message), "*");
  if (message.ok) window.addEventListener("message", receiveMessageFromContainer, false);
}

function receiveMessageFromContainer(event) 
{
    let json = JSON.parse(event.data);
    document.getElementById("message_title").value = json.subject;
    document.getElementById("message_body").value = json.body;
    document.getElementById("new_message").submit();
    
}

