// AllChat is free software under the GNU Affero General Public License v3.0 or later.
package instance

import (
	"mime"
	"net/http"
	"os"
	"path/filepath"
	"strings"
)

func (i *Instance) uploadAttachmentAPI(response http.ResponseWriter, request *http.Request) {
	member, _, ok := i.authenticatedCSRF(response, request)
	if !ok {
		return
	}
	name := request.Header.Get("X-AllChat-Filename")
	if name == "" {
		name = request.URL.Query().Get("filename")
	}
	attachment, err := i.community.UploadAttachment(request.Context(), member, name, request.Header.Get("Content-Type"), request.Body)
	if err != nil {
		writeCommunityError(response, err)
		return
	}
	writeJSON(response, http.StatusCreated, attachment)
}

func (i *Instance) downloadAttachmentAPI(response http.ResponseWriter, request *http.Request) {
	member, _, ok := i.authenticated(response, request)
	if !ok {
		return
	}
	attachment, path, err := i.community.AttachmentDownload(request.Context(), member, request.PathValue("attachmentID"))
	if err != nil {
		writeCommunityError(response, err)
		return
	}
	file, err := os.Open(path)
	if err != nil {
		http.NotFound(response, request)
		return
	}
	defer file.Close()
	info, err := file.Stat()
	if err != nil {
		http.NotFound(response, request)
		return
	}
	media := strings.HasPrefix(attachment.ContentType, "image/") || strings.HasPrefix(attachment.ContentType, "audio/") || strings.HasPrefix(attachment.ContentType, "video/")
	dispositionKind := "attachment"
	contentType := "application/octet-stream"
	if media {
		dispositionKind = "inline"
		contentType = attachment.ContentType
	}
	disposition := mime.FormatMediaType(dispositionKind, map[string]string{"filename": filepath.Base(attachment.Name)})
	response.Header().Set("Content-Disposition", disposition)
	response.Header().Set("Content-Type", contentType)
	response.Header().Set("X-Content-Type-Options", "nosniff")
	response.Header().Set("Content-Security-Policy", "default-src 'none'; sandbox")
	response.Header().Set("Cache-Control", "private, no-store")
	http.ServeContent(response, request, attachment.Name, info.ModTime(), file)
}

func (i *Instance) previewAttachmentAPI(response http.ResponseWriter, request *http.Request) {
	member, _, ok := i.authenticated(response, request)
	if !ok {
		return
	}
	attachment, path, contentType, err := i.community.AttachmentPreview(request.Context(), member, request.PathValue("attachmentID"))
	if err != nil {
		writeCommunityError(response, err)
		return
	}
	file, err := os.Open(path)
	if err != nil {
		http.NotFound(response, request)
		return
	}
	defer file.Close()
	info, err := file.Stat()
	if err != nil {
		http.NotFound(response, request)
		return
	}
	response.Header().Set("Content-Disposition", mime.FormatMediaType("inline", map[string]string{"filename": filepath.Base(attachment.Name)}))
	response.Header().Set("Content-Type", contentType)
	response.Header().Set("X-Content-Type-Options", "nosniff")
	response.Header().Set("Content-Security-Policy", "default-src 'none'; sandbox")
	response.Header().Set("Cache-Control", "private, max-age=31536000, immutable")
	http.ServeContent(response, request, attachment.Name, info.ModTime(), file)
}
