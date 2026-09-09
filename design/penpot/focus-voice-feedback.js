const boards=penpot.currentPage.root.children.filter(b=>b.getPluginData('static-voice-feedback-state'));penpot.viewport.zoomIntoView(boards);return {visibleBoards:boards.length};
