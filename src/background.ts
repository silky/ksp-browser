import {
  ExtensionInbox,
  ScriptInbox,
  LookupResponse,
  IngestResponse,
  OpenResponse,
} from './mailbox'
import * as Protocol from './protocol'

const onRequest = async (
  message: ExtensionInbox,
  { tab }: chrome.runtime.MessageSender
): Promise<null | ScriptInbox> => {
  switch (message.type) {
    case 'CloseRequest': {
      close()
      return null
    }
    case 'OpenRequest': {
      const result = await open(message.url)
      return { type: 'OpenResponse', open: result }
    }
    case 'LookupRequest': {
      chrome.browserAction.disable(tab!.id!)
      chrome.browserAction.setIcon({ path: 'disable-icon-128.png', tabId: tab!.id })
      chrome.browserAction.setBadgeText({ text: ``, tabId: tab!.id })
      const resource = await lookup(message.lookup)
      const count = resource.backLinks.length
      if (count > 0) {
        chrome.browserAction.enable(tab!.id)
        chrome.browserAction.setIcon({ path: 'icon-128.png', tabId: tab!.id })
        chrome.browserAction.setBadgeText({ text: `${count}`, tabId: tab!.id })
      }

      return { type: 'LookupResponse', resource }
    }
    case 'IngestRequest': {
      const result = await ingest(message.resource)
      return { type: 'IngestResponse', ingest: result }
    }
    case 'TagsRequest': {
      return null
    }
  }
}

const open = async (url: string): Promise<Protocol.Open> =>
  ksp(
    {
      query: `mutation open {
        open(url:${JSON.stringify(url)}) {
          openOk
          exitOk
          code
        }
      }`,
      operationName: 'open',
      variables: {},
    },
    (data): Protocol.Open => data.open
  )

const ingest = async (resource: Protocol.InputResource): Promise<{ url: string }> =>
  ksp(
    {
      operationName: 'Ingest',
      variables: { resource },
      query: `mutation Ingest($resource:InputResource!) {
        ingest(resource:$resource) {
          url
        }
      }`,
    },
    (data): { url: string } => data.ingest
  )

const lookup = async (url: string): Promise<Protocol.Resource> =>
  ksp(
    {
      operationName: 'Lookup',
      variables: {},
      query: `query Lookup {
        resource(url: "${url}") {
          url
          backLinks {
            ...backLink
          }
          tags {
            ...tag
          }
        }
      }

      fragment tag on Tag {
        name
      }

      fragment backLink on Link {
        kind
        identifier
        name
        title
        fragment
        location
        referrer {
          url
          info {
            title
            description
            cid
          }
          tags {
            ...tag
          }
        }
      }`,
    },
    (data) => data.resource
  )

const ksp = async <a, b>(input: a, decode: (output: any) => b): Promise<b> => {
  const request = await fetch('http://localhost:8080/graphql', {
    method: 'POST',
    headers: {
      contentType: 'application/json',
    },
    body: JSON.stringify(input),
  })
  const json = await request.json()
  return decode(json.data)
}

const close = () => {}
const executeScript = (details: chrome.tabs.InjectDetails): Promise<any> =>
  new Promise((resolve, reject) => {
    chrome.tabs.executeScript(details, (results) => {
      const error = chrome.runtime.lastError
      if (error !== undefined) {
        reject(error)
      } else {
        resolve(results)
      }
    })
  })

class NoReceiverError extends Error {
  error: chrome.runtime.LastError
  constructor(error: chrome.runtime.LastError) {
    super(error.message)
    this.error = error
  }
}

const executeFunction = <a>(fn: () => a, details: chrome.tabs.InjectDetails = {}): Promise<a> => {
  delete details.file
  return executeScript({
    ...details,
    code: `(${fn})()`,
  })
}

const request = <a, b>(tabId: number, message: a): Promise<b> =>
  new Promise((resolve, reject) => {
    chrome.tabs.sendMessage(tabId, message, (response) => {
      if (response) {
        resolve(response)
      } else if (chrome.runtime.lastError) {
        const error = chrome.runtime.lastError
        if (!error) {
          resolve(response)
        }
        if (error.message && error.message.includes('Receiving end does not exist')) {
          reject(new NoReceiverError(error))
        } else {
          reject(error)
        }
      }
    })
  })

chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
  let response = onRequest(request, sender)
  if (response) {
    Promise.resolve(response).then(sendResponse)
  }
  return true
})
// chrome.browserAction.onClicked.addListener(onBrowserAction)
// chrome.contextMenus.onClicked.addListener(onContextMenuAction)

chrome.browserAction.disable()
chrome.browserAction.setIcon({ path: 'disable-icon-128.png' })
chrome.browserAction.setBadgeBackgroundColor({ color: '#000' })
chrome.browserAction.onClicked.addListener((tab) => {
  chrome.tabs.sendMessage(tab.id!, { type: 'Toggle' })
})
