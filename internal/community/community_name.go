// AllChat is free software under the GNU Affero General Public License v3.0 or later.
package community

import (
	"context"
	"fmt"
	"strings"
	"unicode/utf8"

	"allchat/internal/identity"
)

const DefaultCommunityName = "AllChat Community"

func (s *Service) CommunityName(ctx context.Context) (string, error) {
	var value string
	if err := s.db.QueryRowContext(ctx, "SELECT name FROM community WHERE id=1").Scan(&value); err != nil {
		return "", fmt.Errorf("load Community name: %w", err)
	}
	return value, nil
}

func (s *Service) UpdateCommunityName(ctx context.Context, actor identity.Member, value string) error {
	if !actor.Owner {
		return ErrForbidden
	}
	value = strings.TrimSpace(value)
	if value == "" || utf8.RuneCountInString(value) > 100 {
		return fmt.Errorf("%w: Community name must contain 1 to 100 characters", ErrInvalidInput)
	}
	if _, err := s.db.ExecContext(ctx, "UPDATE community SET name=? WHERE id=1", value); err != nil {
		return fmt.Errorf("update Community name: %w", err)
	}
	return nil
}
