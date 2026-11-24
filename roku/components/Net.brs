' Shared networking helpers for Task nodes.
'
' CRITICAL: Net_HttpGet and Net_HttpPost must only be called from a Task node's
' thread (i.e. from a function invoked via Task control="RUN"), never from the
' render thread. They perform blocking-with-timeout HTTP calls using an
' roUrlTransfer + roMessagePort + wait() pattern so a hung connection can
' never wedge the app.

' Enables certificate verification for https:// server URLs (deploy.sh allows
' them). Without a CA bundle every https request fails. Plain http:// URLs
' skip this so the common LAN setup is unchanged.
sub Net_ConfigureTls(xfer as object, url as string)
    if Left(LCase(url), 8) <> "https://" then return
    xfer.SetCertificatesFile("common:/certs/ca-bundle.crt")
    xfer.InitClientCertificates()
end sub

' Sends the optional LunaTV API token (see roku/README.md, HDHOMERUN_API_TOKEN)
' as a bearer credential. Servers with AUTH_PUBLIC_LIVE=1 (the default) serve
' guide/stream playback without it; recordings and mutations (favorite, record,
' delete) need a token whose role allows them. Empty token = send nothing, so
' unauthenticated deployments are unchanged.
function Net_AuthValue(url as string) as string
    base = GetPackagedServerUrl()
    token = GetPackagedApiToken()
    if base = "" or token = "" then return ""
    ' Match the exact packaged base including scheme, host and port. The
    ' slash boundary keeps similarly named servers from receiving the token.
    prefix = base + "/"
    if Left(url, Len(prefix)) <> prefix then return ""
    return "Bearer " + token
end function

sub Net_ConfigureAuth(xfer as object, url as string)
    value = Net_AuthValue(url)
    if value <> "" then xfer.AddHeader("Authorization", value)
end sub

' Video fetches playlists and segments itself instead of using Net_HttpGet.
sub Net_ConfigureVideoAuth(content as object)
    value = Net_AuthValue(content.url)
    headers = []
    if value <> "" then headers.Push("Authorization:" + value)
    ' Replace any headers left by previous playback on a reused Video node.
    content.HttpHeaders = headers
end sub

' Performs a GET request with a timeout.
' Returns an associative array: { success: boolean, code: integer, body: string, error: string }
function Net_HttpGet(url as string, timeoutMs as integer) as object
    xfer = CreateObject("roUrlTransfer")
    port = CreateObject("roMessagePort")
    xfer.SetMessagePort(port)
    xfer.SetUrl(url)
    Net_ConfigureTls(xfer, url)
    Net_ConfigureAuth(xfer, url)
    xfer.SetRequest("GET")
    xfer.EnableEncodings(true)
    xfer.RetainBodyOnError(true)

    ok = xfer.AsyncGetToString()
    if not ok
        return { success: false, code: 0, body: "", error: "Could not start GET request" }
    end if

    msg = wait(timeoutMs, port)
    if msg = invalid
        xfer.AsyncCancel()
        return { success: false, code: 0, body: "", error: "Request timed out" }
    end if

    if type(msg) = "roUrlEvent"
        code = msg.GetResponseCode()
        body = msg.GetString()
        if code >= 200 and code < 300
            return { success: true, code: code, body: body, error: "" }
        else
            return { success: false, code: code, body: body, error: "HTTP " + code.ToStr() }
        end if
    end if

    return { success: false, code: 0, body: "", error: "Unexpected response from server" }
end function

' Performs a POST request (empty body) with a timeout.
' Returns an associative array: { success: boolean, code: integer, body: string, error: string }
function Net_HttpPost(url as string, timeoutMs as integer) as object
    xfer = CreateObject("roUrlTransfer")
    port = CreateObject("roMessagePort")
    xfer.SetMessagePort(port)
    xfer.SetUrl(url)
    Net_ConfigureTls(xfer, url)
    Net_ConfigureAuth(xfer, url)
    xfer.EnableEncodings(true)
    xfer.RetainBodyOnError(true)
    xfer.AddHeader("Content-Length", "0")

    ok = xfer.AsyncPostFromString("")
    if not ok
        return { success: false, code: 0, body: "", error: "Could not start POST request" }
    end if

    msg = wait(timeoutMs, port)
    if msg = invalid
        xfer.AsyncCancel()
        return { success: false, code: 0, body: "", error: "Request timed out" }
    end if

    if type(msg) = "roUrlEvent"
        code = msg.GetResponseCode()
        body = msg.GetString()
        if code >= 200 and code < 300
            return { success: true, code: code, body: body, error: "" }
        else
            return { success: false, code: code, body: body, error: "HTTP " + code.ToStr() }
        end if
    end if

    return { success: false, code: 0, body: "", error: "Unexpected response from server" }
end function
