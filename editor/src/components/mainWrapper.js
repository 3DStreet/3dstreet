import React from 'react';
import { useAuthContext } from '../contexts/index.js';
import Main from './Main';

const MainWrapper = (props) => {
  const { currentUser } = useAuthContext();
  return <Main {...props} currentUser={currentUser} />;
};

export default MainWrapper;
