import React, { createContext, useContext, useEffect, useRef, useState, useCallback } from 'react';
import { io } from 'socket.io-client';
import { useAuth } from './AuthContext';
import { useSimulator } from '../hooks/useSimulator';

const SocketContext = createContext(null);

// Get server URL based on current environment
const getServerUrl = () => {
  if (typeof window === 'undefined') return 'http://localhost:5000';
  const { hostname } = window.location;
  // If we are on a real device/IP or deployed, we need to point to the server
  // For demo purposes, we'll try to guess if it's production or local
  if (hostname === 'localhost' || hostname === '127.0.0.1') return 'http://localhost:5000';
  return `http://${hostname}:5000`; // Attempt local network IP
};

export const SocketProvider = ({ children }) => {
  const { user } = useAuth();
  const socketRef = useRef(null);
  
  // Real-time data from server
  const [drivers, setDrivers] = useState([]);
  const [orders, setOrders]   = useState([]);
  const [stats, setStats]     = useState(() => {
    try {
      const saved = localStorage.getItem('taxi_stats');
      return saved ? JSON.parse(saved) : { totalEarnings: 0, tripsCompleted: 0 };
    } catch { return { totalEarnings: 0, tripsCompleted: 0 }; }
  });
  const [connected, setConnected] = useState(false);
  const [isDemo, setIsDemo]       = useState(false);

  // Simulator fallback for offline/demo mode
  const sim = useSimulator();

  useEffect(() => {
    if (!user) return;

    const SERVER = getServerUrl();
    console.log('Connecting to:', SERVER);

    const socket = io(SERVER, { 
      transports: ['websocket'],
      reconnectionAttempts: 3,
      timeout: 5000
    });
    
    socketRef.current = socket;

    socket.on('connect', () => {
      setConnected(true);
      setIsDemo(false);
    });

    socket.on('connect_error', () => {
      // If server is unreachable after a few tries, switch to demo/simulator
      if (!connected) {
        setIsDemo(true);
        setConnected(true); // "Connected" to simulator
      }
    });

    socket.on('drivers:update', setDrivers);
    socket.on('orders:current', setOrders);
    socket.on('stats:update', (newStats) => {
      setStats(newStats);
      localStorage.setItem('taxi_stats', JSON.stringify(newStats));
    });
    
    socket.on('order:new', (order) => {
      setOrders(prev => [order, ...prev.filter(o => o._id !== order._id)]);
    });

    socket.on('order:update', (updated) => {
      if (updated.status === 'completed' || updated.status === 'cancelled') {
        setOrders(prev => prev.filter(o => o._id !== updated._id));
      } else {
        setOrders(prev => prev.map(o => o._id === updated._id ? updated : o));
      }
    });

    return () => socket.disconnect();
  }, [user, connected]);

  // Unified actions
  const acceptOrder = useCallback((orderId, driverId) => {
    if (isDemo) {
      const order = sim.orders.find(o => o.id === orderId) || orders.find(o => o.id === orderId);
      if (order) sim.handleAcceptOrder(order);
    } else {
      socketRef.current?.emit('order:accept', { orderId, driverId });
      setOrders(prev => prev.filter(o => o._id !== orderId));
    }
  }, [isDemo, sim, orders]);

  const cancelOrder = useCallback((orderId) => {
    if (isDemo) {
      // Simulator cancel logic if needed
    } else {
      socketRef.current?.emit('order:cancel', { orderId });
      setOrders(prev => prev.filter(o => o._id !== orderId));
    }
  }, [isDemo]);

  // Provide either server data or simulator data
  const value = {
    drivers: isDemo ? sim.fleet : drivers,
    orders:  isDemo ? sim.orders : orders,
    stats:   isDemo ? sim.stats  : stats,
    connected,
    isDemo,
    acceptOrder,
    cancelOrder
  };

  return (
    <SocketContext.Provider value={value}>
      {children}
    </SocketContext.Provider>
  );
};

export const useSocket = () => useContext(SocketContext);

