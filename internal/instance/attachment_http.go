// AllChat is free software under the GNU Affero General Public License v3.0 or later.
package instance

import (
	"mime"
	"net/http"
	"os"
	"path/filepath"
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
	disposition := mime.FormatMediaType("attachment", map[string]string{"filename": filepath.Base(attachment.Name)})
	response.Header().Set("Content-Disposition", disposition)
	response.Header().Set("Content-Type", "application/octet-stream")
	response.Header().Set("X-Content-Type-Options", "nosniff")
	response.Header().Set("Content-Security-Policy", "default-src 'none'; sandbox")
	response.Header().Set("Cache-Control", "private, no-store")
	http.ServeContent(response, request, attachment.Name, info.ModTime(), file)
}
