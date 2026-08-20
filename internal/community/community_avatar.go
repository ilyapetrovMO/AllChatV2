// AllChat is free software under the GNU Affero General Public License v3.0 or later.
package community

import (
	"context"
	"fmt"
)

func (s *Service) SetCommunityAvatar(ctx context.Context, contentType string, data []byte) error {
	if len(data) < 1 || len(data) > 8<<20 {
		return fmt.Errorf("%w: avatar must be between 1 byte and 8 MiB", ErrInvalidInput)
	}
	if contentType != "image/png" && contentType != "image/jpeg" && contentType != "image/webp" {
		return fmt.Errorf("%w: avatar must be PNG, JPEG, or WebP", ErrInvalidInput)
	}
	_, err := s.db.ExecContext(ctx, "UPDATE community SET avatar=?, avatar_content_type=? WHERE id=1", data, contentType)
	return err
}

func (s *Service) RemoveCommunityAvatar(ctx context.Context) error {
	_, err := s.db.ExecContext(ctx, "UPDATE community SET avatar=NULL, avatar_content_type=NULL WHERE id=1")
	return err
}

func (s *Service) CommunityAvatar(ctx context.Context) ([]byte, string, error) {
	var data []byte
	var contentType string
	if err := s.db.QueryRowContext(ctx, "SELECT avatar,avatar_content_type FROM community WHERE id=1 AND avatar IS NOT NULL").Scan(&data, &contentType); err != nil {
		return nil, "", err
	}
	return data, contentType, nil
}

func (s *Service) HasCommunityAvatar(ctx context.Context) bool {
	var exists bool
	_ = s.db.QueryRowContext(ctx, "SELECT avatar IS NOT NULL FROM community WHERE id=1").Scan(&exists)
	return exists
}
