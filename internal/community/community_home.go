// AllChat is free software under the GNU Affero General Public License v3.0 or later.
package community

import (
	"context"
	"fmt"
	"strings"

	"allchat/internal/identity"
)

func (s *Service) CommunityHomeMarkdown(ctx context.Context) (string, error) {
	var value string
	if err := s.db.QueryRowContext(ctx, "SELECT home_markdown FROM community WHERE id=1").Scan(&value); err != nil {
		return "", fmt.Errorf("load Community home: %w", err)
	}
	return value, nil
}

func (s *Service) UpdateCommunityHomeMarkdown(ctx context.Context, actor identity.Member, value string) error {
	if !actor.Owner {
		return ErrForbidden
	}
	if len([]byte(value)) > 100_000 {
		return fmt.Errorf("%w: Community home must be at most 100 KB", ErrInvalidInput)
	}
	_, err := s.db.ExecContext(ctx, "UPDATE community SET home_markdown=? WHERE id=1", strings.TrimSpace(value))
	if err != nil {
		return fmt.Errorf("update Community home: %w", err)
	}
	return nil
}
