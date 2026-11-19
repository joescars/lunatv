' Shared by PlayerScreen and RecordingPlayerScreen.
' Builds a one-line, screen-safe message: a human headline plus a trimmed hint
' from the underlying error, if there is one worth showing.
function friendlyError(headline as string, detail as dynamic) as string
    if detail = invalid or detail = "" then return headline

    text = detail.Trim()

    ' Prefer the last non-empty line - for ffmpeg output that's the part
    ' closest to the actual failure.
    lines = text.Split(Chr(10))
    for i = lines.Count() - 1 to 0 step -1
        candidate = lines[i].Trim()
        if candidate <> ""
            text = candidate
            exit for
        end if
    end for

    maxLen = 120
    if Len(text) > maxLen
        text = Left(text, maxLen - 1) + Chr(8230) ' ellipsis
    end if

    return headline + " - " + text
end function
