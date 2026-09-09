return {revision:penpot.currentFile.revn,version:(await penpot.currentFile.findVersions()).find(v=>v.label==='Desktop design — milestone 59 General minimum feedback')};
