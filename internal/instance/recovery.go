// AllChat is free software under the GNU Affero General Public License v3.0 or later.
package instance

import (
	"context"
	"fmt"
	"os"
	"path/filepath"

	"allchat/internal/identity"
)

// RecoverOwner resets the unique Owner credentials while the Instance is
// offline. Possession of the data directory is the recovery authority.
func RecoverOwner(ctx context.Context, dataDir, username, password string) (err error) {
	absoluteDataDir, err := filepath.Abs(dataDir)
	if err != nil {
		return fmt.Errorf("resolve data directory: %w", err)
	}
	if _, err := os.Stat(filepath.Join(absoluteDataDir, "allchat.db")); err != nil {
		return fmt.Errorf("open existing Instance: %w", err)
	}
	lock, err := acquireLock(filepath.Join(absoluteDataDir, "instance.lock"))
	if err != nil {
		return err
	}
	defer func() { err = errorsJoin(err, releaseLock(lock)) }()
	db, err := openDatabase(absoluteDataDir)
	if err != nil {
		return err
	}
	defer func() { err = errorsJoin(err, db.Close()) }()
	if err := initializeSchema(db); err != nil {
		return err
	}
	service, err := identity.New(db, absoluteDataDir)
	if err != nil {
		return err
	}
	return service.RecoverOwner(ctx, username, password)
}

func errorsJoin(left, right error) error {
	if left != nil {
		return left
	}
	return right
}
