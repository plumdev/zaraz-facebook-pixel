import { ComponentSettings, MCEvent } from '@managed-components/types'
import { flattenKeys } from './utils'

const USER_DATA: Record<string, { fbKey: string; hashed?: boolean }> = {
  email: { fbKey: 'em', hashed: true },
  phone: { fbKey: 'ph', hashed: true },
  firstName: { fbKey: 'fn', hashed: true },
  lastName: { fbKey: 'ln', hashed: true },
  dateOfBirth: { fbKey: 'db', hashed: true },
  gender: { fbKey: 'ge', hashed: true },
  city: { fbKey: 'ct', hashed: true },
  state: { fbKey: 'st', hashed: true },
  postalCode: { fbKey: 'zp', hashed: true },
  country: { fbKey: 'country', hashed: true },
  id: { fbKey: 'external_id', hashed: true },
  subscriptionId: { fbKey: 'subscription_id' },
  loginId: { fbKey: 'fb_login_id' },
  leadId: { fbKey: 'lead_id' },
}

// Build the start of every FB Cookie
// https://developers.facebook.com/docs/marketing-api/conversions-api/parameters/fbp-and-fbc/
const fbCookieBase = (event: MCEvent) => {
  const { client } = event
  return (
    'fb.' +
    (client.url.hostname
      ? client.url.hostname.split('.').length - 1
      : client.url.href.split('/')[2].split('.').length - 1) +
    '.' +
    new Date().valueOf() +
    '.'
  )
}

const setNewFBP = (event: MCEvent) => {
  const val =
    fbCookieBase(event) + String(Math.round(2147483647 * Math.random()))
  event.client.set('fb-pixel', val)
  return val
}

const getFBC = (event: MCEvent) => {
  const { client } = event
  let fbc = client.get('fb-click') || ''

  if (client.url.searchParams?.get('fbclid')) {
    fbc = fbCookieBase(event) + client.url.searchParams.get('fbclid')
    client.set('fb-click', fbc)
  }
  return fbc
}

const getBaseRequestBody = (
  eventType: string,
  event: MCEvent,
  settings: ComponentSettings
) => {
  const { client, payload } = event

  // Use the incoming event_id or generate a new one
  const eventId =
    payload.event_id ||
    payload.ecommerce?.event_id ||
    String(Math.round(Math.random() * 100000000000000000))
  delete payload.event_id
  delete payload.ecommerce?.event_id

  const fbp = event.client.get('fb-pixel') || setNewFBP(event)

  const body: { [k: string]: any } = {
    event_name:
      (eventType === 'pageview' ? 'PageView' : payload.ev) ||
      event.name ||
      event.type,
    event_id: eventId,
    action_source: 'website',
    event_time:
      client.timestamp && client.timestamp > 9999999999
        ? Math.floor(client.timestamp / 1e3)
        : client.timestamp,
    event_source_url: payload.dl || client.url.href,
    ...(settings.dataProcessingOptions && {
      data_processing_options: [settings.dataProcessingOptions],
      ...(settings.dataProcessingOptionsCountry && {
        data_processing_options_country: parseInt(
          settings.dataProcessingOptionsCountry
        ),
      }),
      ...(settings.dataProcessingOptionsState && {
        data_processing_options_state: parseInt(
          settings.dataProcessingOptionsState
        ),
      }),
    }),
    user_data: {
      fbp,
      ...(!settings.hideClientIP && {
        client_user_agent: client.userAgent,
        client_ip_address: client.ip,
      }),
    },
    custom_data: {},
  }
  delete payload.ev

  return body
}

export const getRequestBody = async (
  eventType: string,
  event: MCEvent,
  settings: ComponentSettings
) => {
  let payload
  if (eventType === 'ecommerce') {
    payload = event.payload.ecommerce
  } else {
    payload = event.payload
  }
  const fbc = getFBC(event)
  const body = getBaseRequestBody(eventType, event, settings)

  // appending hashed user data
  const userData = { ...payload.user, ...payload.user?.facebook }
  delete payload.user

  const encoder = new TextEncoder()
  for (const [key, { fbKey, hashed }] of Object.entries(USER_DATA)) {
    let value = userData[key]
    if (value) {
      if (hashed) {
        const data = encoder.encode(String(value).trim().toLowerCase())
        const digest = await crypto.subtle.digest('SHA-256', data)
        const hashArray = Array.from(new Uint8Array(digest))
        value = hashArray.map(b => b.toString(16).padStart(2, '0')).join('')
      }
      body.user_data[fbKey] = value
      delete payload[key]
    }
  }

  if (fbc) {
    body.user_data.fbc = fbc
  }

  body.custom_data = flattenKeys(payload)

  return body
}
