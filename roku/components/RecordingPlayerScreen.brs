sub init()
    m.video = m.top.findNode("video")
    m.overlay = m.top.findNode("overlay")
    m.status = m.top.findNode("status")
    m.task = invalid
    m.closed = false
    m.video.observeField("state", "onVideoState")
end sub

sub onScreenFocus()
    m.top.setFocus(true)
    if m.closed = true then return
    if m.task = invalid and m.video.visible = false
        m.status.text = "Loading " + m.top.title
        task = CreateObject("roSGNode", "RecordingStreamTask")
        task.serverUrl = m.top.serverUrl
        task.recordingId = m.top.recordingId
        task.observeField("result", "onStreamResult")
        m.task = task
        task.control = "RUN"
    end if
end sub

sub onStreamResult(event as object)
    if m.closed = true then return
    result = event.getData()
    m.task = invalid
    if result = invalid or result.success <> true
        reason = "unknown error"
        if result <> invalid and GetInterface(result, "ifAssociativeArray") <> invalid
            err = result.error
            if err <> invalid and GetInterface(err, "ifString") <> invalid and err <> "" then reason = err
        end if
        m.status.text = "Playback failed: " + reason
        return
    end if
    content = CreateObject("roSGNode", "ContentNode")
    content.url = m.top.serverUrl + "/recordings/" + m.top.recordingId + "/medium/stream.m3u8"
    content.streamFormat = "hls"
    m.video.content = content
    m.overlay.visible = false
    m.status.visible = false
    m.video.visible = true
    m.video.control = "play"
end sub

sub onVideoState(event as object)
    if event.getData() = "error" then m.status.text = "Playback error"
end sub

function onKeyEvent(key as string, press as boolean) as boolean
    if press and key = "back"
        m.closed = true
        cancelStreamTask()
        m.video.control = "stop"
        m.top.closed = true
        return true
    end if
    return false
end function

sub cancelStreamTask()
    if m.task <> invalid
        m.task.unobserveField("result")
        m.task.control = "STOP"
        m.task = invalid
    end if
end sub
