' RecordingStopTask releases a recording transcode without blocking the UI
' thread: POST /recordings/<id>/<profile>/stop. Without it the server keeps
' ffmpeg running until its idle timeout.
sub init()
    m.top.functionName = "doStop"
end sub

sub doStop()
    if m.top.serverUrl = invalid or m.top.serverUrl = "" or m.top.recordingId = invalid or m.top.recordingId = "" then return
    profile = m.top.profile
    if profile = invalid or profile = "" then profile = "medium"
    Net_HttpPost(m.top.serverUrl + "/recordings/" + m.top.recordingId + "/" + profile + "/stop", 3000)
end sub
