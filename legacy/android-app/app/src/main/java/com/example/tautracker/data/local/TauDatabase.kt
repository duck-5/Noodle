package com.example.tautracker.data.local

import androidx.room.Database
import androidx.room.RoomDatabase
import com.example.tautracker.data.local.dao.AssignmentDao
import com.example.tautracker.data.local.dao.CourseDao
import com.example.tautracker.data.local.entity.AssignmentEntity
import com.example.tautracker.data.local.entity.CourseEntity

@Database(entities = [CourseEntity::class, AssignmentEntity::class], version = 1, exportSchema = false)
abstract class TauDatabase : RoomDatabase() {
    abstract fun courseDao(): CourseDao
    abstract fun assignmentDao(): AssignmentDao
}
