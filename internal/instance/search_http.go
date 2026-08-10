// AllChat is free software under the GNU Affero General Public License v3.0 or later.
package instance

import (
	"html/template"
	"net/http"
	"strconv"
)

func (i *Instance) searchMessagesAPI(response http.ResponseWriter, request *http.Request) {
	member, _, ok := i.authenticated(response, request)
	if !ok {
		return
	}
	limit, _ := strconv.Atoi(request.URL.Query().Get("limit"))
	page, err := i.community.SearchMessagePage(request.Context(), member, request.URL.Query().Get("q"), request.URL.Query().Get("cursor"), limit)
	if err != nil {
		writeCommunityError(response, err)
		return
	}
	writeJSON(response, http.StatusOK, page)
}

func (i *Instance) searchPage(response http.ResponseWriter, request *http.Request) {
	member, _, ok := i.authenticated(response, request)
	if !ok {
		return
	}
	query := request.URL.Query().Get("q")
	var results any
	var searchError string
	if query != "" {
		found, err := i.community.SearchMessages(request.Context(), member, query, 50)
		if err != nil {
			searchError = err.Error()
		} else {
			results = found
		}
	}
	response.Header().Set("Content-Type", "text/html; charset=utf-8")
	_ = searchTemplate.Execute(response, map[string]any{"Query": query, "Results": results, "Error": searchError})
}

var searchTemplate = template.Must(template.New("search").Parse(`<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Search — AllChat</title><link rel="stylesheet" href="/assets/app.css"><script src="/assets/app.js" defer></script></head><body><div class="app-shell"><aside class="community-rail"><a class="community-mark" href="/" aria-label="AllChat home">AC</a></aside><aside class="channel-sidebar"><div class="community-header">Explore AllChat</div><nav class="channel-nav settings-nav"><a href="/search" aria-current="page">Search</a><a href="/profile">My Account</a><a href="/sessions">Sessions</a><a href="/">Back to Community</a></nav></aside><main class="content-shell"><header class="content-header"><button class="mobile-menu" type="button" data-sidebar-toggle aria-label="Open search navigation" aria-expanded="false">☰</button><h1>Search</h1></header><section class="content"><h2 class="page-title">Search Messages</h2><form class="card form-row" method="get" action="/search"><label>Search query<input type="search" name="q" value="{{.Query}}" maxlength="200" placeholder="Search this Community" required autofocus></label><button>Search</button></form>{{if .Error}}<p class="notice notice-error" role="alert">{{.Error}}</p>{{end}}<ol class="list">{{range .Results}}<li class="list-item search-result"><div class="list-item-main"><a href="{{.URL}}">#{{.ChannelName}}</a> <span class="faint">in {{.CategoryName}}</span> — <strong>{{.Message.AuthorName}}</strong><p>{{.Snippet}}</p></div></li>{{else}}{{if $.Query}}<li class="muted">No authorized Messages matched your search.</li>{{end}}{{end}}</ol></section></main></div></body></html>`))
