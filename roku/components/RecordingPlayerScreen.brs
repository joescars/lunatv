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
        if result <> invalid and GetInterface(result, "ifAssociativeArray") <> invalid and result.error <> invalid
            print "[RecordingPlayerScreen] playback preparation failed: "; result.error
        end if
        m.status.text = friendlyError("Playback failed", reason)
        return
    end if
    content = CreateObject("roSGNode", "ContentNode")
    content.url = m.top.serverUrl + "/recordings/" + m.top.recordingId + "/medium/stream.m3u8"
    content.streamFormat = "hls"
    applyAuthHeader(content)
    m.video.content = content
    m.overlay.visible = false
    m.status.visible = false
    m.video.visible = true
    m.video.control = "play"
end sub

sub onVideoState(event as object)
    if event.getData() = "error"
        if m.video.errorMsg <> invalid and m.video.errorMsg <> ""
            print "[RecordingPlayerScreen] playback error: "; m.video.errorMsg
        end if
        m.video.visible = false
        m.overlay.visible = true
        m.status.visible = true
        m.status.text = friendlyError("Playback error", m.video.errorMsg)
    end if
end sub

function onKeyEvent(key as string, press as boolean) as boolean
    if press and key = "back"
        m.closed = true
        cancelStreamTask()
        m.video.control = "stop"
        requestRecordingStop()
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

' Releases the server-side transcode now instead of waiting for its idle
' timeout. Safe if /start never completed: the server treats stop as a no-op.
sub requestRecordingStop()
    if m.top.recordingId = invalid or m.top.recordingId = "" then return
    task = CreateObject("roSGNode", "RecordingStopTask")
    task.serverUrl = m.top.serverUrl
    task.recordingId = m.top.recordingId
    task.profile = "medium"
    task.control = "RUN"
end sub

' Playlist/segment requests made by the Video node bypass Net.brs, so the
' optional API token must be set on the content itself.
sub applyAuthHeader(content as object)
    token = GetPackagedApiToken()
    if token <> "" then content.HttpHeaders = ["Authorization: Bearer " + token]
end sub
