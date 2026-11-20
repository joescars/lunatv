' deploy.sh replaces this fallback in the packaged copy when
' HDHOMERUN_WEB_URL is set.
function GetPackagedServerUrl() as string
    return "http://192.168.68.121:8080"
end function

' Optional bearer token for servers that require authentication for recordings
' and mutations. deploy.sh fills it from HDHOMERUN_API_TOKEN; empty by default.
function GetPackagedApiToken() as string
    return ""
end function
