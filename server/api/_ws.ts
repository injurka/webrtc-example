/* eslint-disable no-console */
import type { Peer } from 'crossws'
import { getQuery } from 'ufo'

enum EActions {
  JOIN = 'join',
  ADD_PEER = 'add-peer',
  LEAVE = 'leave',
  RELAY_SDP = 'relay-sdp',
  RELAY_ICE = 'relay-ice',
  SESSION_DESCRIPTION = 'session-description',
  ICE_CANDIDATE = 'ice-candidate',
  REMOVE_PEER = 'remove-peer',
}

type Client = string

const clients = new Map<Client, Peer>()
const rooms = new Map<string, Set<Client>>()

export default defineWebSocketHandler({
  open(peer) {
    console.log('\n[ws] open', peer)

    const userId = getUserId(peer)
    const existPeer = clients.get(userId)

    if (existPeer)
      handleLeave(existPeer)

    clients.set(userId, peer)
  },

  message(peer, message) {
    console.log('\n[ws] message', peer, message)

    const data = JSON.parse(message.toString())

    switch (data.action) {
      case EActions.JOIN:
        handleJoin(peer, data.payload)
        break
      case EActions.LEAVE:
        handleLeave(peer, data.payload)
        break
      case EActions.RELAY_SDP:
        handleRelaySDP(peer, data.payload)
        break
      case EActions.RELAY_ICE:
        handleRelayICE(peer, data.payload)
        break
      default:
        console.log('Unknown action:', data.action)
    }
  },

  close(peer, event) {
    console.log('[ws] close', peer, event)
    handleLeave(peer)
  },

  error(peer, error) {
    console.log('[ws] error', peer, error)
  },
})

function handleJoin(peer: Peer, payload: { roomId: string }) {
  const { roomId } = payload

  const userId = getUserId(peer)

  let room = rooms.get(roomId)!
  if (!room) {
    room = new Set()
    rooms.set(roomId, room)
  }

  if (room?.has(userId)) {
    return console.warn(`${userId} already joined to ${roomId}`)
  }

  peer.publish(roomId, { user: 'server', message: `${userId} joined!` })

  room.forEach((userRoomId) => {
    const remotePeer = clients.get(userRoomId)!

    remotePeer.send({
      action: EActions.ADD_PEER,
      payload: {
        peerId: userId,
        createOffer: false,
      },
    })

    peer.send({
      action: EActions.ADD_PEER,
      payload: {
        peerId: userRoomId,
        createOffer: true,
      },
    })
  })

  room.add(userId)
  peer.subscribe(roomId)
}

function handleLeave(peer: Peer, payload?: { roomId: string }) {
  const { roomId } = payload ?? { roomId: null }
  const userId = getUserId(peer)!
  const existClient = clients.get(userId)!

  if (existClient?.id !== peer?.id) {
    return
  }

  const removePeerFromRoom = (roomId: string) => {
    const roomClients = rooms.get(roomId)!

    roomClients.forEach((roomUserId) => {
      const remotePeer = clients.get(roomUserId)!

      remotePeer.send({
        action: EActions.REMOVE_PEER,
        payload: {
          peerId: userId,
        },
      })
    })
    peer.unsubscribe(roomId)
    roomClients.delete(userId)
  }

  const roomsIds = [...peer._subscriptions, roomId].filter(f => f !== null && f !== undefined)

  roomsIds.forEach((subRoomId) => {
    removePeerFromRoom(subRoomId)
  })

  clients.delete(userId)
}

function handleRelaySDP(peer: Peer, payload: { peerId: string, sessionDescription: any }) {
  const { peerId, sessionDescription } = payload

  const remotePeer = clients.get(peerId)!

  remotePeer.send({
    action: EActions.SESSION_DESCRIPTION,
    payload: {
      peerId: getUserId(peer),
      sessionDescription,
    },
  })
}

function handleRelayICE(peer: Peer, payload: { peerId: string, iceCandidate: any }) {
  const { peerId, iceCandidate } = payload

  const remotePeer = clients.get(peerId)!

  remotePeer.send({
    action: EActions.ICE_CANDIDATE,
    payload: {
      peerId: getUserId(peer),
      iceCandidate,
    },
  })
}

function getUserId(peer: Peer) {
  const query = getQuery(peer.url)
  return query.userId as string
}
