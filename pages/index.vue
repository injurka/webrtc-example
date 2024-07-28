<!-- eslint-disable no-console -->

<script lang="ts" setup>
import { faker } from '@faker-js/faker'

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
interface HasDevice {
  hasCam: boolean
  hasMic: boolean
}

interface DeviceState {
  isCam: boolean
  isMic: boolean
}

let ws: WebSocket | undefined
const LOCAL_VIDEO = 'LOCAL_VIDEO'

const lastUserId = useCookie<string>('userId', { default: () => faker.lorem.word() })
const lastRoomId = useCookie<number>('roomId', { default: () => 1 })

const isMic = ref<DeviceState['isMic']>(true)
const isCam = ref<DeviceState['isCam']>(false)
const isConnected = ref<boolean>(false)
const isConnecting = ref<boolean>(false)
const clients = ref<string[]>([])
const localMediaStream = ref<MediaStream | null>(null)
const peerConnections = ref<Record<string, RTCPeerConnection>>({})
const peerMediaElements = ref<Record<string, HTMLVideoElement>>({
  [LOCAL_VIDEO]: {} as HTMLVideoElement,
})
const settings = ref<{ roomId: number, userId: string }>({
  roomId: lastRoomId.value,
  userId: lastUserId.value,
})

const respondents = computed(() => clients.value.filter(f => f !== LOCAL_VIDEO))

function wsClose() {
  if (ws) {
    ws.close()
    isConnected.value = false
  }
}

async function disconnect() {
  sendMessage(EActions.LEAVE, {})
  wsClose()
}

async function connect() {
  const { roomId, userId } = settings.value

  isConnected.value = false
  isConnecting.value = true

  try {
    await startCapture()
  }
  catch (e) {
    console.error('Error getting userMedia:', e)
    isConnecting.value = false
    return
  }

  lastUserId.value = userId
  lastRoomId.value = roomId

  const isSecure = location.protocol === 'https:'
  const url = `${(isSecure ? 'ws://' : 'ws://') + location.host}/api/_ws?userId=${userId}`

  if (ws) {
    console.log('ws', 'Closing previous connection before reconnecting...')
    ws.close()
  }

  console.log('ws', 'Connecting to', url, '...')
  ws = new WebSocket(url)

  await new Promise(resolve => ws!.addEventListener('open', resolve))
  console.log('ws', 'Connected!')

  ws.addEventListener('message', (event) => {
    const data = JSON.parse(event.data)
    console.log('Message: ', data)

    if (!data.action)
      return

    switch (data.action) {
      case EActions.ADD_PEER:
        handleNewPeer(data.payload)
        break
      case EActions.SESSION_DESCRIPTION:
        setRemoteMedia(data.payload)
        break
      case EActions.ICE_CANDIDATE:
        handleIceCandidate(data.payload)
        break
      case EActions.REMOVE_PEER:
        handleRemovePeer(data.payload)
        break
      default:
        console.log('Unknown action:', data)
    }
  })

  sendMessage(EActions.JOIN, { roomId })

  isConnecting.value = false
  isConnected.value = true
}

function sendMessage(action: EActions, payload: any) {
  if (ws && ws.readyState === WebSocket.OPEN) {
    ws.send(JSON.stringify({ action, payload }))
  }
}

function connectedHandler() {
  Object.keys(peerMediaElements.value).forEach(key =>
    peerMediaElements.value[key].play(),
  )
}

async function setRemoteMedia(props: {
  peerId: string
  sessionDescription: RTCSessionDescriptionInit
}) {
  const { peerId, sessionDescription: remoteDescription } = props

  await peerConnections.value[peerId]?.setRemoteDescription(
    new RTCSessionDescription(remoteDescription),
  )

  if (remoteDescription.type === 'offer') {
    const answer = await peerConnections.value[peerId].createAnswer()

    await peerConnections.value[peerId].setLocalDescription(answer)

    sendMessage(EActions.RELAY_SDP, {
      peerId,
      sessionDescription: answer,
    })
  }
}

async function handleNewPeer(props: { peerId: string, createOffer: boolean }) {
  const { peerId, createOffer } = props

  peerConnections.value[peerId] = new RTCPeerConnection({
    // iceServers: [],
  })
  peerConnections.value[peerId].onicecandidate = (event) => {
    if (event.candidate) {
      sendMessage(EActions.RELAY_ICE, {
        peerId,
        iceCandidate: event.candidate,
      })
    }
  }
  peerConnections.value[peerId].ontrack = ({ streams: [remoteStream] }) => {
    nextTick(() => {
      peerMediaElements.value[peerId].srcObject = remoteStream
    })
  }
  clients.value.push(peerId)

  if (localMediaStream.value) {
    localMediaStream.value.getTracks().forEach((track) => {
      peerConnections.value[peerId].addTrack(track, localMediaStream.value as MediaStream)
    })
  }

  if (createOffer) {
    const offer = await peerConnections.value[peerId].createOffer()

    await peerConnections.value[peerId].setLocalDescription(offer)

    sendMessage(EActions.RELAY_SDP, {
      peerId,
      sessionDescription: offer,
    })
  }
}

async function handleIceCandidate(props: { peerId: string, iceCandidate: RTCIceCandidateInit }) {
  const { peerId, iceCandidate } = props

  peerConnections.value[peerId]?.addIceCandidate(new RTCIceCandidate(iceCandidate))
}

function handleRemovePeer(props: { peerId: string }) {
  const { peerId } = props

  if (peerConnections.value[peerId]) {
    peerConnections.value[peerId].close()

    delete peerConnections.value[peerId]
    delete peerMediaElements.value[peerId]
  }
  else if (`${peerId}` === `${lastUserId.value}`) {
    wsClose()
  }

  clients.value = clients.value.filter(c => c !== peerId)
}

async function startCapture() {
  const devices = await window.navigator.mediaDevices.enumerateDevices()

  const cams = devices.filter(device => device.kind === 'videoinput')
  const mics = devices.filter(device => device.kind === 'audioinput')

  const hasMic = mics.length > 0
  const hasCam = cams.length > 0
  const hasDevice = { hasCam, hasMic }

  const [stream, _] = await createMediaStream(hasDevice)

  console.log('stream', stream)

  localMediaStream.value = stream
  clients.value.push(LOCAL_VIDEO)
  peerMediaElements.value[LOCAL_VIDEO].srcObject = localMediaStream.value
}

async function createMediaStream(hasDevice: HasDevice): Promise<[MediaStream, HasDevice]> {
  let stream: MediaStream

  const { hasCam, hasMic } = hasDevice
  const hasInterface = hasCam || hasMic

  const makeFakeStream = (): MediaStream => {
    const canvas = window.document.createElement('canvas')
    canvas.getContext('2d')

    const core = () => {
      return canvas.captureStream()
    }

    return core()
  }

  if (hasInterface) {
    stream = await window.navigator.mediaDevices.getUserMedia({
      video: hasCam,
      audio: hasMic
        ? {
            echoCancellation: true,
            noiseSuppression: true,
            autoGainControl: true,
          }
        : false,
    })
  }
  else {
    stream = makeFakeStream()
  }

  return [
    stream,
    hasDevice,
  ]
}

function setMic(value: DeviceState['isMic']) {
  isMic.value = value

  if (localMediaStream.value) {
    localMediaStream.value
      .getAudioTracks()
      .forEach(audioTrack => (audioTrack.enabled = value))
  }
}

function setCam(value: DeviceState['isMic']) {
  isCam.value = value

  if (localMediaStream.value) {
    localMediaStream.value
      .getVideoTracks()
      .forEach(videoTrack => (videoTrack.enabled = value))
  }
}

onBeforeUnmount(() => {
  disconnect()
})
</script>

<template>
  <div class="webrtc">
    <div class="members">
      <div
        v-for="respondent in respondents"
        :key="respondent"
        class="members-item respondent"
      >
        <video
          :ref="(el) => (peerMediaElements[respondent] = el as HTMLVideoElement)"
          class="respondent-video"
          autoplay
          playsinline
          @onloadedmetadata="connectedHandler"
        />
      </div>

      <div class="members-item local">
        <video
          :ref="(el) => (peerMediaElements[LOCAL_VIDEO] = el as HTMLVideoElement)"
          class="local-video"
          autoplay
          playsinline
          muted
          @onloadedmetadata="() => peerMediaElements[LOCAL_VIDEO].play()"
        />
      </div>
    </div>
    <div class="control">
      <div class="control-settings">
        <div class="control-settings-room">
          <v-text-field
            v-model="settings.userId"
            width="185"
            label="Username"
            variant="filled"
            :disabled="isConnected"
          />
          <v-text-field
            v-model="settings.roomId"
            width="185"
            label="Room"
            variant="filled"
            :disabled="isConnected"
          />
        </div>
        <div class="control-settings-btns">
          <v-btn
            v-if="!isConnected"
            width="185"
            height="48"
            color="primary"
            @click="connect"
          >
            Join room
          </v-btn>
          <v-btn
            v-else
            width="185"
            height="48"
            color="primary"
            @click="disconnect"
          >
            Leave room
          </v-btn>
          <v-btn
            :color="isCam ? '' : 'secondary'"
            :icon="`mdi-video${isCam ? '' : '-off'}`"
            @click="setCam(!isCam)"
          />
          <v-btn
            :color="isMic ? '' : 'secondary'"
            :icon="`mdi-microphone${isMic ? '' : '-off'}`"
            @click="setMic(!isMic)"
          />
        </div>
        <v-overlay
          :model-value="isConnecting"
          class="align-center justify-center"
        >
          <v-progress-circular
            color="primary"
            size="32"
            indeterminate
          />
        </v-overlay>
      </div>
    </div>
  </div>
</template>

<style lang="scss" scoped>
.webrtc {
  display: flex;
  align-items: center;
  justify-content: center;
  flex-direction: column;

  gap: 36px;

  height: 100vh;
  width: 100vw;
}

.members {
  background-color: #f4f6fa;
  border: 1px solid #22263b1a;
  max-width: 844px;

  display: flex;
  flex-wrap: wrap;
  gap: 10px;
  align-items: center;
  justify-content: center;
  padding: 32px;

  &-item {
    width: 384px;
    height: 216px;

    video {
      background-color: #3440791a;
      border: 1px solid #344079;
      border-radius: 8px;
      object-fit: 'fill';

      background:
        url('/images/user.png') no-repeat center/170px local border-box,
        url('/images/background.png') repeat center/80px local border-box;

      width: 100%;
      height: 100%;
    }
  }
}

.control {
  &-settings {
    display: flex;
    flex-direction: column;
    gap: 8px;
    background-color: #f4f6fa;
    border: 1px solid #22263b1a;
    padding: 32px;

    &-room {
      display: flex;
      flex-direction: row;
      gap: 14px;
    }
    &-btns {
      display: flex;
      justify-content: center;
      gap: 14px;
      * {
        text-transform: none;
      }
    }
  }
}
</style>
