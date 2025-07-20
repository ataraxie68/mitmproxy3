"""
Configuration loader utility for the GA4 + Marketing Pixel Logger.
Loads configuration from config.json and provides it to all components.
"""

import json
from typing import Dict, Any, Optional, Set, NamedTuple
from pathlib import Path

class ConfigLoader:
    """Loads and provides access to application configuration."""
    
    def __init__(self, config_path: Optional[str] = None):
        """
        Initialize the configuration loader.
        
        Args:
            config_path: Path to the config.json file. If None, uses default location.
        """
        if config_path is None:
            # Default to config.json in the same directory as this script
            config_path = Path(__file__).parent / "config.json"
        
        self.config_path = Path(config_path)
        self._config: Dict[str, Any] = {}
        self._load_config()
    
    def _load_config(self) -> None:
        """Load configuration from JSON file."""
        try:
            with open(self.config_path, 'r', encoding='utf-8') as f:
                self._config = json.load(f)
        except FileNotFoundError:
            raise FileNotFoundError(f"Configuration file not found: {self.config_path}")
        except json.JSONDecodeError as e:
            raise ValueError(f"Invalid JSON in configuration file: {e}")
    
    def get(self, key: str, default: Any = None) -> Any:
        """
        Get a configuration value using dot notation.
        
        Args:
            key: Configuration key (e.g., 'ui.ga4Icon' or 'websocket.port')
            default: Default value if key not found
            
        Returns:
            Configuration value or default
        """
        keys = key.split('.')
        value = self._config
        
        for k in keys:
            if isinstance(value, dict) and k in value:
                value = value[k]
            else:
                return default
        
        return value
    
    def get_ui_config(self) -> Dict[str, Any]:
        """Get UI-specific configuration."""
        return self._config.get('ui', {})
    
    def get_platforms(self) -> list:
        """Get list of supported platforms from platformConfigs."""
        return list(self.get_all_platform_configs().keys())
    
    def get_websocket_config(self) -> Dict[str, Any]:
        """Get WebSocket configuration."""
        return self._config.get('websocket', {})
    
    def get_logging_config(self) -> Dict[str, Any]:
        """Get logging configuration."""
        return self._config.get('logging', {})
    
    def get_proxy_config(self) -> Dict[str, Any]:
        """Get proxy configuration."""
        return self._config.get('proxy', {})
    
    def get_browser_config(self) -> Dict[str, Any]:
        """Get browser configuration."""
        return self._config.get('browser', {})
    
    def get_platform_icon(self, platform: str) -> str:
        """Get icon for a specific platform from platformConfigs."""
        platform_config = self.get_platform_config(platform)
        if platform_config and 'ui' in platform_config:
            return platform_config['ui'].get('icon', '<i class="fa-solid fa-mobile brand-icon"></i>')
        return '<i class="fa-solid fa-mobile brand-icon"></i>'
    
    def get_platform_highlight_class(self, platform: str) -> str:
        """Get highlight CSS class for a specific platform from platformConfigs."""
        platform_config = self.get_platform_config(platform)
        if platform_config and 'ui' in platform_config:
            return platform_config['ui'].get('highlightClass', 'universal-highlight-default')
        return 'universal-highlight-default'
    
    def get_platform_color(self, platform: str) -> str:
        """Get color for a specific platform from platformConfigs."""
        platform_config = self.get_platform_config(platform)
        if platform_config and 'ui' in platform_config:
            return platform_config['ui'].get('color', '#6366F1')
        return '#6366F1'
    
    def get_platform_config(self, platform: str) -> Dict[str, Any]:
        """Get platform configuration."""
        return self.get(f'platformConfigs.{platform}', {})
    
    def get_all_platform_configs(self) -> Dict[str, Any]:
        """Get all platform configurations."""
        return self.get('platformConfigs', {})
    
    def get_server_tracking_config(self) -> Dict[str, Any]:
        """Get server tracking configuration."""
        return self.get('serverTracking', {})
    
    def get_all_hosts(self) -> Set[str]:
        """Get all hosts from platform configurations."""
        hosts = set()
        for platform_config in self.get_all_platform_configs().values():
            hosts.update(platform_config.get('hosts', []))
        return hosts
    
    def get_all_paths(self) -> Set[str]:
        """Get all paths from platform configurations."""
        paths = set()
        for platform_config in self.get_all_platform_configs().values():
            paths.update(platform_config.get('paths', []))
        return paths
    
    def get_platform_icon_map(self) -> Dict[str, str]:
        """Generate platform icon map from platformConfigs."""
        icon_map = {}
        for platform, config in self.get_all_platform_configs().items():
            if 'ui' in config and 'icon' in config['ui']:
                icon_map[platform] = config['ui']['icon']
            else:
                icon_map[platform] = '<i class="fa-solid fa-mobile brand-icon"></i>'
        return icon_map
    
    def get_platform_highlight_class_map(self) -> Dict[str, str]:
        """Generate platform highlight class map from platformConfigs."""
        highlight_map = {}
        for platform, config in self.get_all_platform_configs().items():
            if 'ui' in config and 'highlightClass' in config['ui']:
                highlight_map[platform] = config['ui']['highlightClass']
            else:
                highlight_map[platform] = 'universal-highlight-default'
        return highlight_map
    
    def get_platform_color_map(self) -> Dict[str, str]:
        """Generate platform color map from platformConfigs."""
        color_map = {}
        for platform, config in self.get_all_platform_configs().items():
            if 'ui' in config and 'color' in config['ui']:
                color_map[platform] = config['ui']['color']
            else:
                color_map[platform] = '#6366F1'
        return color_map
    
    def reload(self) -> None:
        """Reload configuration from file."""
        self._load_config()

# Global configuration instance
_config_loader: Optional[ConfigLoader] = None

def get_config() -> ConfigLoader:
    """Get the global configuration loader instance."""
    global _config_loader
    if _config_loader is None:
        _config_loader = ConfigLoader()
    return _config_loader

def init_config(config_path: Optional[str] = None) -> ConfigLoader:
    """Initialize the global configuration loader with a specific path."""
    global _config_loader
    _config_loader = ConfigLoader(config_path)
    return _config_loader

# Export commonly used functions
def get_ui_config() -> Dict[str, Any]:
    """Get UI configuration."""
    return get_config().get_ui_config()

def get_platforms() -> list:
    """Get list of supported platforms."""
    return get_config().get_platforms()

def get_websocket_config() -> Dict[str, Any]:
    """Get WebSocket configuration."""
    return get_config().get_websocket_config()

def get_platform_icon(platform: str) -> str:
    """Get icon for a specific platform."""
    return get_config().get_platform_icon(platform)

def get_platform_highlight_class(platform: str) -> str:
    """Get highlight CSS class for a specific platform."""
    return get_config().get_platform_highlight_class(platform)

def get_platform_color(platform: str) -> str:
    """Get color for a specific platform."""
    return get_config().get_platform_color(platform)

def get_platform_config(platform: str) -> Dict[str, Any]:
    """Get platform configuration."""
    return get_config().get_platform_config(platform)

def get_all_platform_configs() -> Dict[str, Any]:
    """Get all platform configurations."""
    return get_config().get_all_platform_configs()

def get_server_tracking_config() -> Dict[str, Any]:
    """Get server tracking configuration."""
    return get_config().get_server_tracking_config()

def get_all_hosts() -> Set[str]:
    """Get all hosts from platform configurations."""
    return get_config().get_all_hosts()

def get_all_paths() -> Set[str]:
    """Get all paths from platform configurations."""
    return get_config().get_all_paths()

# PlatformConfig class for backward compatibility
class PlatformConfig(NamedTuple):
    """Configuration for tracking platforms - backward compatibility."""
    name: str
    hosts: Set[str]
    paths: Set[str]
    param_map: Dict[str, str]
    pixel_id_key: str
    event_name_key: str
    custom_event_handler: Optional[str] = None
    description: Optional[str] = None

def get_platform_config_as_namedtuple(platform: str) -> Optional[PlatformConfig]:
    """Get platform configuration as NamedTuple for backward compatibility."""
    config_dict = get_platform_config(platform)
    if not config_dict:
        return None
    
    return PlatformConfig(
        name=config_dict.get('name', platform),
        hosts=set(config_dict.get('hosts', [])),
        paths=set(config_dict.get('paths', [])),
        param_map=config_dict.get('paramMap', {}),
        pixel_id_key=config_dict.get('pixelIdKey', 'id'),
        event_name_key=config_dict.get('eventNameKey', 'event'),
        custom_event_handler=config_dict.get('customEventHandler'),
        description=config_dict.get('description')
    )

def get_platforms_dict() -> Dict[str, PlatformConfig]:
    """Get all platforms as dictionary of NamedTuples for backward compatibility."""
    platforms = {}
    for platform_name in get_platforms():
        platform_config = get_platform_config_as_namedtuple(platform_name)
        if platform_config:
            platforms[platform_name] = platform_config
    return platforms