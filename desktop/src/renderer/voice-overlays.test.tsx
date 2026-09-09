import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { SoundboardMenu, VoiceMemberMenu } from './app';

function menuProps() {
  return { name: 'sam', context: 'In Lounge', avatar: <span>S</span>, presence: 'online',
    self: false, canModerate: false, serverMuted: false, volume: 1, left: 20, top: 20,
    onVolume: vi.fn(), onProfile: vi.fn(), onMessage: vi.fn(), onMute: vi.fn(),
    onDisconnect: vi.fn(), onCopy: vi.fn(), onClose: vi.fn() };
}

describe('Voice Member menu permissions and actions', () => {
  it('limits self menus to profile and copy, even for an owner', () => {
    const props = menuProps();
    render(<VoiceMemberMenu {...props} self canModerate />);
    expect(screen.queryByRole('slider')).not.toBeInTheDocument();
    expect(screen.queryByRole('group', {name:'Community actions'})).not.toBeInTheDocument();
    expect(screen.getAllByRole('menuitem')).toHaveLength(2);
    fireEvent.click(screen.getByRole('menuitem', {name:'View profile'}));
    fireEvent.click(screen.getByRole('menuitem', {name:'Copy user ID'}));
    expect(props.onProfile).toHaveBeenCalledOnce();
    expect(props.onCopy).toHaveBeenCalledOnce();
  });
  it('exposes personal volume and messaging without moderation to members', () => {
    const props = menuProps();
    render(<VoiceMemberMenu {...props} />);
    fireEvent.change(screen.getByRole('slider', {name:'sam volume'}), {target:{value:'0.35'}});
    expect(props.onVolume).toHaveBeenCalledWith(.35);
    fireEvent.click(screen.getByRole('menuitem', {name:'Message'}));
    expect(props.onMessage).toHaveBeenCalledOnce();
    expect(screen.queryByRole('menuitemcheckbox')).not.toBeInTheDocument();
    fireEvent.keyDown(screen.getByRole('menu'), {key:'Escape'});
    expect(props.onClose).toHaveBeenCalledOnce();
  });
  it('shows the current mute state and dispatches owner actions', () => {
    const props = menuProps();
    render(<VoiceMemberMenu {...props} canModerate serverMuted />);
    const mute = screen.getByRole('menuitemcheckbox', {name:'Server mute'});
    expect(mute).toHaveAttribute('aria-checked','true');
    fireEvent.click(mute);
    fireEvent.click(screen.getByRole('menuitem', {name:'Disconnect'}));
    expect(props.onMute).toHaveBeenCalledOnce();
    expect(props.onDisconnect).toHaveBeenCalledOnce();
  });
});

describe('Compact soundboard', () => {
  it('plays the selected sound in a large collection and closes by keyboard', () => {
    const onPlay=vi.fn(), onClose=vi.fn();
    const sounds=Array.from({length:40},(_,i)=>({id:String(i),name:`Sound ${i}`}));
    render(<SoundboardMenu sounds={sounds} onPlay={onPlay} onClose={onClose} />);
    expect(screen.getAllByRole('button')).toHaveLength(41);
    fireEvent.click(screen.getByRole('button', {name:'Sound 39'}));
    expect(onPlay).toHaveBeenCalledWith('39');
    expect(screen.queryByText('Community sounds')).not.toBeInTheDocument();
    expect(screen.queryByText('Choose a sound to play')).not.toBeInTheDocument();
    fireEvent.keyDown(screen.getByRole('dialog'), {key:'Escape'});
    expect(onClose).toHaveBeenCalledOnce();
  });
  it('shows the approved empty state and a working close control', () => {
    const onClose=vi.fn();
    render(<SoundboardMenu sounds={[]} onPlay={vi.fn()} onClose={onClose} />);
    expect(screen.getByText('No sounds yet')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', {name:'Close soundboard'}));
    expect(onClose).toHaveBeenCalledOnce();
  });
});
